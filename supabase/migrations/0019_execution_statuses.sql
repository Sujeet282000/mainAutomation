-- Additive status vocabulary for durable execution and compatibility mapping.
ALTER TYPE public.run_status ADD VALUE IF NOT EXISTS 'waiting';
ALTER TYPE public.run_status ADD VALUE IF NOT EXISTS 'retrying';
ALTER TYPE public.run_status ADD VALUE IF NOT EXISTS 'timed_out';
ALTER TYPE public.run_status ADD VALUE IF NOT EXISTS 'expired';

ALTER TYPE public.step_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE public.step_status ADD VALUE IF NOT EXISTS 'waiting';
ALTER TYPE public.step_status ADD VALUE IF NOT EXISTS 'retrying';
ALTER TYPE public.step_status ADD VALUE IF NOT EXISTS 'cancelled';