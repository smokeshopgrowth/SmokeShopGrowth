/**
 * CallLeadButton — One-click Vapi call from any lead row/drawer
 *
 * Drop into src/components/leads/ and add to LeadDrawer or LeadsTable actions.
 *
 * Usage:
 *   import { CallLeadButton } from '@/components/leads/CallLeadButton';
 *   <CallLeadButton leadId={lead.id} phone={lead.phone} businessName={lead.business_name} />
 */
import { useState } from 'react';
import { Phone, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface CallLeadButtonProps {
  leadId: string;
  phone: string | null;
  businessName: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'icon';
}

export function CallLeadButton({
  leadId,
  phone,
  businessName,
  variant = 'outline',
  size = 'sm',
}: CallLeadButtonProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'calling' | 'success' | 'error'>('idle');

  const handleCall = async () => {
    if (!phone) {
      toast.error('No phone number for this lead');
      return;
    }

    setStatus('calling');

    try {
      const { data, error } = await supabase.functions.invoke('vapi-outbound-call', {
        body: { leadId },
      });

      if (error) throw error;

      setStatus('success');
      toast.success(`Calling ${businessName}...`, {
        description: `Call ID: ${data.callId}`,
      });

      // Refresh lead data
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['lead-activities', leadId] });

      // Reset after 3s
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err) {
      setStatus('error');
      toast.error(`Call failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  if (!phone) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={variant} size={size} disabled className="gap-1.5 opacity-50">
              <Phone className="h-3.5 w-3.5" />
              {size !== 'icon' && 'Call'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>No phone number</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleCall}
      disabled={status === 'calling'}
      className={`gap-1.5 ${
        status === 'success'
          ? 'text-green-600 border-green-600'
          : status === 'error'
          ? 'text-red-600 border-red-600'
          : ''
      }`}
    >
      {status === 'calling' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : status === 'success' ? (
        <CheckCircle className="h-3.5 w-3.5" />
      ) : status === 'error' ? (
        <XCircle className="h-3.5 w-3.5" />
      ) : (
        <Phone className="h-3.5 w-3.5" />
      )}
      {size !== 'icon' &&
        (status === 'calling'
          ? 'Calling...'
          : status === 'success'
          ? 'Call started'
          : status === 'error'
          ? 'Failed'
          : 'Call')}
    </Button>
  );
}
