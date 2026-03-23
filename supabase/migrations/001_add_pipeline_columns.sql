-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Add pipeline columns + call tracking to blue-rocket-dash
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- ── 1. Add city column to leads (needed for scraper) ─────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS city text;

-- ── 2. Add website_url alias (some components use 'website', some 'website_url')
-- The existing column is 'website', so we just make sure it exists
-- (It does — this is a safety check)

-- ── 3. Create call_logs table for tracking Vapi calls ────────────────────
CREATE TABLE IF NOT EXISTS public.call_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  call_id text,                     -- Vapi call ID
  phone text NOT NULL,
  business_name text,
  status text DEFAULT 'initiated',  -- initiated, completed, voicemail, no_answer, failed
  duration_seconds integer DEFAULT 0,
  ended_reason text,
  transcript text,
  summary text,
  call_result text,                 -- interested, short_call, voicemail, no_answer, failed
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS for call_logs
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own call logs"
  ON public.call_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own call logs"
  ON public.call_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── 4. Create pipeline_runs table for tracking pipeline executions ───────
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  city text NOT NULL,
  status text DEFAULT 'running',    -- running, completed, failed
  options jsonb DEFAULT '{}',
  results jsonb DEFAULT '{}',
  leads_scraped integer DEFAULT 0,
  leads_qualified integer DEFAULT 0,
  calls_made integer DEFAULT 0,
  sites_generated integer DEFAULT 0,
  emails_sent integer DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- RLS for pipeline_runs
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pipeline runs"
  ON public.pipeline_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pipeline runs"
  ON public.pipeline_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pipeline runs"
  ON public.pipeline_runs FOR UPDATE
  USING (auth.uid() = user_id);

-- ── 5. Add Vapi + pipeline settings to user_settings ─────────────────────
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS vapi_api_key text,
  ADD COLUMN IF NOT EXISTS vapi_assistant_id text,
  ADD COLUMN IF NOT EXISTS vapi_phone_number_id text,
  ADD COLUMN IF NOT EXISTS agent_name text DEFAULT 'Alex',
  ADD COLUMN IF NOT EXISTS auto_call_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_generate_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_email_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_score_threshold integer DEFAULT 6,
  ADD COLUMN IF NOT EXISTS telegram_bot_token text,
  ADD COLUMN IF NOT EXISTS telegram_chat_id text;

-- ── 6. Add indexes for performance ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_city ON public.leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_ai_score ON public.leads(ai_score);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id ON public.call_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_id ON public.pipeline_runs(user_id);

-- ── 7. Update leads enum to add 'qualified' if not already there ────────
-- Check if 'qualified' exists in the lead_status enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.lead_status'::regtype
    AND enumlabel = 'qualified'
  ) THEN
    ALTER TYPE public.lead_status ADD VALUE IF NOT EXISTS 'qualified';
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    -- lead_status might be a text column, not an enum — that's fine
    NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Done! Your Supabase project now supports the full pipeline.
-- ═══════════════════════════════════════════════════════════════════════════
