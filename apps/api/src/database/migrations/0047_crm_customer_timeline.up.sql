CREATE TABLE crm.interactions (
  id uuid PRIMARY KEY,
  customer_partner_id uuid NOT NULL
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid,
  contact_person_id uuid,
  interaction_type varchar(30) NOT NULL,
  subject varchar(255) NOT NULL,
  notes text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_interaction_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT crm_interaction_contact_customer_fk
    FOREIGN KEY (contact_person_id, customer_partner_id)
    REFERENCES master_data.partner_contacts(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT crm_interaction_type_valid CHECK (
    interaction_type IN ('incoming_call', 'outgoing_call', 'email', 'chat', 'on_site_visit')
  ),
  CONSTRAINT crm_interaction_subject_nonempty CHECK (
    subject = btrim(subject) AND char_length(subject) > 0
  ),
  CONSTRAINT crm_interaction_notes_nonempty CHECK (
    notes = btrim(notes) AND char_length(notes) > 0
  )
);

CREATE INDEX crm_interactions_customer_timeline_idx
  ON crm.interactions (customer_partner_id, occurred_at DESC, id DESC);
CREATE INDEX crm_interactions_location_timeline_idx
  ON crm.interactions (customer_location_id, occurred_at DESC, id DESC)
  WHERE customer_location_id IS NOT NULL;

CREATE TABLE crm.tasks (
  id uuid PRIMARY KEY,
  customer_partner_id uuid NOT NULL
    REFERENCES master_data.partners(id) ON DELETE RESTRICT,
  customer_location_id uuid,
  title varchar(255) NOT NULL,
  notes text,
  priority varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open',
  assigned_to_account_id uuid NOT NULL
    REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_task_location_customer_fk
    FOREIGN KEY (customer_location_id, customer_partner_id)
    REFERENCES master_data.customer_locations(id, partner_id) ON DELETE RESTRICT,
  CONSTRAINT crm_task_title_nonempty CHECK (
    title = btrim(title) AND char_length(title) > 0
  ),
  CONSTRAINT crm_task_notes_nonempty CHECK (
    notes IS NULL OR (notes = btrim(notes) AND char_length(notes) > 0)
  ),
  CONSTRAINT crm_task_priority_valid CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT crm_task_status_valid CHECK (status IN ('open', 'completed', 'cancelled')),
  CONSTRAINT crm_task_lifecycle_valid CHECK (
    (status = 'open' AND completed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  ),
  CONSTRAINT crm_task_version_positive CHECK (version > 0)
);

CREATE INDEX crm_tasks_customer_due_idx
  ON crm.tasks (customer_partner_id, status, due_at, id);
CREATE INDEX crm_tasks_assignee_due_idx
  ON crm.tasks (assigned_to_account_id, status, due_at, id)
  WHERE status = 'open';

CREATE TABLE crm.task_history (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES crm.tasks(id) ON DELETE RESTRICT,
  event_type varchar(20) NOT NULL,
  status varchar(20) NOT NULL,
  note text,
  changed_by uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_task_history_type_valid CHECK (
    event_type IN ('created', 'completed', 'cancelled')
  ),
  CONSTRAINT crm_task_history_status_valid CHECK (status IN ('open', 'completed', 'cancelled')),
  CONSTRAINT crm_task_history_note_nonempty CHECK (
    note IS NULL OR (note = btrim(note) AND char_length(note) > 0)
  )
);

CREATE INDEX crm_task_history_timeline_idx
  ON crm.task_history (task_id, changed_at DESC, id DESC);

CREATE TABLE crm.task_reminders (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES crm.tasks(id) ON DELETE RESTRICT,
  recipient_account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE RESTRICT,
  remind_at timestamptz NOT NULL,
  notification_id uuid NOT NULL UNIQUE
    REFERENCES notifications.messages(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, recipient_account_id, remind_at)
);

CREATE INDEX crm_task_reminders_task_idx
  ON crm.task_reminders (task_id, remind_at, id);

COMMENT ON TABLE crm.interactions IS
  'Customer and location communication history, including calls, email, chat, and visits.';
COMMENT ON TABLE crm.task_history IS
  'Immutable CRM task lifecycle used in customer and location timelines.';
COMMENT ON TABLE crm.task_reminders IS
  'Scheduled CRM reminders backed by reliable, idempotent notification messages.';
