import os
import json
import time
from deploy_agent import deploy_shop_website
from delivery_agent import trigger_delivery_flow

QUEUE_FILE = "failed_jobs_queue.json"

def log_failed_job(job_type, payload, error_msg):
    """
    Logs a failed job to a local JSON file so it can be retried later.
    Job Types: 'deploy', 'delivery', 'crm_update'
    """
    print(f"\n[ERROR MONITOR] An error occurred in '{job_type}'. Saving to retry queue.")
    
    # Load existing queue
    queue = []
    if os.path.exists(QUEUE_FILE):
        try:
            with open(QUEUE_FILE, "r") as f:
                queue = json.load(f)
        except Exception:
            queue = []
            
    # Append new failed job
    job_entry = {
        "id": str(time.time()),
        "type": job_type,
        "payload": payload,
        "error": str(error_msg),
        "retries": 0,
        "timestamp": time.ctime()
    }
    
    queue.append(job_entry)
    
    # Save back to file
    with open(QUEUE_FILE, "w") as f:
        json.dump(queue, f, indent=4)
        
    print(f"  [*] Saved failed '{job_type}' job to {QUEUE_FILE}.")


def process_retry_queue():
    """
    Reads the failed jobs queue and attempts to process them again.
    This script can be run on a scheduled cron job (e.g., every 15 minutes).
    """
    if not os.path.exists(QUEUE_FILE):
        print("[RETRY AGENT] Queue is empty. No failed jobs to retry.")
        return
        
    with open(QUEUE_FILE, "r") as f:
        queue = json.load(f)
        
    if not queue:
        print("[RETRY AGENT] Queue is empty. No failed jobs to retry.")
        return
        
    print(f"=========================================")
    print(f" [RETRY AGENT] Processing {len(queue)} failed jobs...")
    print(f"=========================================\n")
    
    remaining_queue = []
    
    for job in queue:
        job_type = job.get('type')
        payload = job.get('payload')
        retries = job.get('retries', 0)
        
        if retries >= 3:
            print(f"  [Skip] Job {job['id']} has exceeded max retries. Keeping in queue but ignoring.")
            remaining_queue.append(job)
            continue
            
        print(f"  > Retrying {job_type} job (Attempt {retries + 1})...")
        success = False
        
        try:
            if job_type == 'deploy':
                # Re-attempt deployment
                url = deploy_shop_website(payload)
                if url:
                    # If it deployed successfully, we must now trigger delivery!
                    # Next time it will fall into 'delivery' if delivery fails, 
                    # but for now we try to complete the chain inline.
                    trigger_delivery_flow(payload, url)
                    success = True
            
            elif job_type == 'delivery':
                # Payload requires lead_data and live_url
                lead_data = payload.get('lead_data')
                live_url = payload.get('live_url')
                trigger_delivery_flow(lead_data, live_url)
                success = True
                
            elif job_type == 'crm_update':
                email = payload.get('email')
                ref_id = payload.get('ref_id')
                from webhook import update_crm_payment
                # Usually update_crm_payment logs internally, we assume true if it doesn't crash
                update_crm_payment(email, ref_id)
                success = True
                
        except Exception as e:
            print(f"  [Error] Retry failed: {e}")
            job['error'] = str(e)
            
        if success:
            print(f"  [*] SUCCESS! Job {job['id']} completed and removed from queue.")
        else:
            job['retries'] += 1
            remaining_queue.append(job)
            
    # Save the remaining failed jobs back to the file
    with open(QUEUE_FILE, "w") as f:
        json.dump(remaining_queue, f, indent=4)
        
    print("\n[RETRY AGENT] Queue processing complete.")


if __name__ == "__main__":
    process_retry_queue()
