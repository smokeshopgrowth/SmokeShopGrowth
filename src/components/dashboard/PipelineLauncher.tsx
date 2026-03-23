/**
 * PipelineLauncher — "Run Pipeline" button for the Dashboard
 *
 * Drop this into src/components/dashboard/ and import it in Dashboard.tsx
 * or QuickActions.tsx.
 *
 * Usage:
 *   import { PipelineLauncher } from '@/components/dashboard/PipelineLauncher';
 *   <PipelineLauncher />
 */
import { useState } from 'react';
import {
  Rocket,
  Loader2,
  MapPin,
  Phone,
  Globe,
  Mail,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface PipelineStep {
  name: string;
  icon: typeof Rocket;
  status: 'pending' | 'running' | 'success' | 'error';
  detail?: string;
}

export function PipelineLauncher() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState('');
  const [running, setRunning] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Options
  const [autoCall, setAutoCall] = useState(true);
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [autoEmail, setAutoEmail] = useState(false);
  const [maxCalls, setMaxCalls] = useState(10);

  // Progress
  const [steps, setSteps] = useState<PipelineStep[]>([]);

  const updateStep = (
    index: number,
    status: PipelineStep['status'],
    detail?: string
  ) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], status, detail: detail || next[index].detail };
      return next;
    });
  };

  const runPipeline = async () => {
    if (!city.trim() || !user) return;

    setRunning(true);
    setSteps([
      { name: 'Scraping leads', icon: MapPin, status: 'running' },
      { name: 'Scoring & qualifying', icon: CheckCircle, status: 'pending' },
      ...(autoCall
        ? [{ name: 'Calling leads via Vapi', icon: Phone, status: 'pending' as const }]
        : []),
      ...(autoGenerate
        ? [{ name: 'Generating demo websites', icon: Globe, status: 'pending' as const }]
        : []),
      ...(autoEmail
        ? [{ name: 'Emailing previews', icon: Mail, status: 'pending' as const }]
        : []),
    ]);

    try {
      const { data, error } = await supabase.functions.invoke('run-pipeline', {
        body: {
          city: city.trim(),
          userId: user.id,
          options: {
            autoCall,
            autoGenerate,
            autoEmail,
            maxCalls,
          },
        },
      });

      if (error) throw error;

      // Update step statuses based on results
      let stepIdx = 0;

      // Scrape
      const scrape = data.steps?.scrape;
      if (scrape?.success) {
        updateStep(stepIdx, 'success', `${scrape.inserted} new leads found`);
      } else {
        updateStep(stepIdx, 'error', scrape?.error || 'Scrape failed');
      }
      stepIdx++;

      // Qualify
      const qualify = data.steps?.qualify;
      if (qualify?.success) {
        updateStep(stepIdx, 'success', `${qualify.qualifiedCount} qualified`);
      } else {
        updateStep(stepIdx, 'error', qualify?.error);
      }
      stepIdx++;

      // Call
      if (autoCall) {
        const call = data.steps?.call;
        if (call) {
          updateStep(
            stepIdx,
            'success',
            `${call.succeeded}/${call.attempted} calls connected`
          );
        } else {
          updateStep(stepIdx, 'error', 'Calls skipped');
        }
        stepIdx++;
      }

      // Generate
      if (autoGenerate) {
        const gen = data.steps?.generate;
        if (gen) {
          updateStep(
            stepIdx,
            'success',
            `${gen.generated} sites generated`
          );
        } else {
          updateStep(stepIdx, 'error');
        }
        stepIdx++;
      }

      // Email
      if (autoEmail) {
        const email = data.steps?.email;
        if (email) {
          updateStep(stepIdx, 'success', `${email.sent} emails sent`);
        } else {
          updateStep(stepIdx, 'error');
        }
      }

      // Refresh dashboard data
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });

      toast.success(`Pipeline complete for ${city}!`);
    } catch (err) {
      console.error('Pipeline error:', err);
      toast.error(
        `Pipeline failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
      // Mark all pending steps as error
      setSteps((prev) =>
        prev.map((s) =>
          s.status === 'pending' || s.status === 'running'
            ? { ...s, status: 'error' as const }
            : s
        )
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="gap-2 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white shadow-lg"
        size="lg"
      >
        <Rocket className="h-5 w-5" />
        Run Pipeline
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              Launch Pipeline
            </DialogTitle>
            <DialogDescription>
              Enter a city to scrape smoke shops, score leads, call them, and
              generate demo websites — all in one shot.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* City Input */}
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="city"
                  placeholder="e.g. Houston, Miami, Denver..."
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="pl-9"
                  disabled={running}
                />
              </div>
            </div>

            {/* Advanced Options */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              Advanced options
            </button>

            {showAdvanced && (
              <div className="space-y-3 rounded-lg border border-border p-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-call" className="text-sm">
                    Auto-call leads via Vapi
                  </Label>
                  <Switch
                    id="auto-call"
                    checked={autoCall}
                    onCheckedChange={setAutoCall}
                    disabled={running}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-generate" className="text-sm">
                    Generate demo websites
                  </Label>
                  <Switch
                    id="auto-generate"
                    checked={autoGenerate}
                    onCheckedChange={setAutoGenerate}
                    disabled={running}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-email" className="text-sm">
                    Auto-email previews
                  </Label>
                  <Switch
                    id="auto-email"
                    checked={autoEmail}
                    onCheckedChange={setAutoEmail}
                    disabled={running}
                  />
                </div>

                {autoCall && (
                  <div className="space-y-1">
                    <Label htmlFor="max-calls" className="text-sm">
                      Max calls per run
                    </Label>
                    <Input
                      id="max-calls"
                      type="number"
                      min={1}
                      max={50}
                      value={maxCalls}
                      onChange={(e) => setMaxCalls(Number(e.target.value))}
                      className="w-20"
                      disabled={running}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Progress */}
            {steps.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    {step.status === 'running' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : step.status === 'success' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : step.status === 'error' ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border-2 border-muted" />
                    )}
                    <span
                      className={
                        step.status === 'pending'
                          ? 'text-muted-foreground'
                          : 'text-foreground'
                      }
                    >
                      {step.name}
                    </span>
                    {step.detail && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {step.detail}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={running}>
              {running ? 'Running...' : 'Cancel'}
            </Button>
            <Button
              onClick={runPipeline}
              disabled={!city.trim() || running}
              className="gap-2"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {running ? 'Pipeline running...' : 'Launch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
