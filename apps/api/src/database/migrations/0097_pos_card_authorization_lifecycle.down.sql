DROP TRIGGER pos_card_authorization_events_immutable ON pos.card_authorization_events;
DROP FUNCTION pos.reject_card_authorization_event_mutation();
DROP TABLE pos.card_authorization_events;
DROP TABLE pos.card_authorization_attempts;
