create table if not exists audit_logs (
  id text primary key,
  type text not null,
  actor jsonb not null,
  tool_id text,
  task_id text,
  approval_id text,
  risk_level text,
  policy_effect text,
  input jsonb,
  output jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists audit_logs_created_at_idx on audit_logs (created_at desc);
create index if not exists audit_logs_task_id_idx on audit_logs (task_id);
create index if not exists audit_logs_tool_id_idx on audit_logs (tool_id);

