CREATE TABLE reporting.overview_preferences (
  owner_account_id uuid PRIMARY KEY REFERENCES identity.user_accounts(id),
  hidden_cards jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(hidden_cards) = 'array'),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0)
);
