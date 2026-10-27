CREATE TABLE users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE CHECK(email=lower(email)), username text NOT NULL UNIQUE CHECK(username ~ '^[a-z][a-z0-9_]{2,29}$'), display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 60), password_hash text NOT NULL,
 balance bigint NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 9007199254740991), verified_at timestamptz, deactivated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), avatar bytea, avatar_type text CHECK(avatar_type IN ('image/webp')),
 CHECK((avatar IS NULL)=(avatar_type IS NULL)), CHECK(octet_length(avatar)<=2097152)
);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE account_tokens (token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),purpose text NOT NULL CHECK(purpose IN ('verify','reset')),expires_at timestamptz NOT NULL,consumed_at timestamptz);
CREATE TABLE teams (id text PRIMARY KEY,profile jsonb NOT NULL, strength numeric(5,2) NOT NULL CHECK(strength BETWEEN 1 AND 100), manager_id text UNIQUE REFERENCES users(id));
CREATE UNIQUE INDEX team_slug ON teams((profile->>'slug'));
CREATE TABLE players (id text PRIMARY KEY,team_id text NOT NULL REFERENCES teams(id),generation_key text NOT NULL UNIQUE,shirt_number integer NOT NULL CHECK(shirt_number BETWEEN 1 AND 99),payload jsonb NOT NULL, UNIQUE(team_id,shirt_number),CHECK((payload->>'overall')::int BETWEEN 1 AND 99));
CREATE TABLE lineups (id text PRIMARY KEY,team_id text NOT NULL REFERENCES teams(id),kind text NOT NULL CHECK(kind IN ('official','draft','alternative')),payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX one_lineup_kind ON lineups(team_id,kind) WHERE kind<>'alternative';
CREATE TABLE rounds (id text PRIMARY KEY,week_number integer NOT NULL UNIQUE CHECK(week_number>0),lifecycle_key text NOT NULL UNIQUE,opens_at timestamptz NOT NULL,closes_at timestamptz NOT NULL,status text NOT NULL CHECK(status IN ('OPEN','CLOSED','SETTLED')),CHECK(opens_at<closes_at));
CREATE TABLE matches (
 id text PRIMARY KEY, round_id text NOT NULL REFERENCES rounds(id),home_id text NOT NULL REFERENCES teams(id),away_id text NOT NULL REFERENCES teams(id),scheduled_at timestamptz NOT NULL,lineup_locks_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','RESOLVED')), input jsonb, seed text NOT NULL,engine_version text NOT NULL, state jsonb,revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),result jsonb,resolved_at timestamptz,
 UNIQUE(round_id,home_id,away_id), CHECK(home_id<>away_id),CHECK(lineup_locks_at=scheduled_at-interval '1 hour'),CHECK((status='RESOLVED')=(result IS NOT NULL AND resolved_at IS NOT NULL)),CHECK(state IS NULL OR input IS NOT NULL)
);
CREATE INDEX match_deadline ON matches(scheduled_at) WHERE status='SCHEDULED';
CREATE TABLE odds (id text PRIMARY KEY,match_id text NOT NULL REFERENCES matches(id),market text NOT NULL CHECK(market IN ('MATCH_RESULT','EXACT_SCORE','TOTAL_CARDS','TOTAL_CORNERS')),selection text NOT NULL,odds numeric(10,4) NOT NULL CHECK(odds>=1.01),revision integer NOT NULL CHECK(revision>=0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(match_id,revision,market,selection));
CREATE TABLE bets (id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),match_id text NOT NULL REFERENCES matches(id),quote_id text NOT NULL REFERENCES odds(id),request_id uuid NOT NULL,stake integer NOT NULL CHECK(stake BETWEEN 1 AND 1000000),status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','WON','LOST','CANCELLED')),payout bigint CHECK(payout BETWEEN 0 AND 9007199254740991),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,request_id),CHECK((status IN ('WON','LOST'))=(payout IS NOT NULL)));
CREATE INDEX bets_user ON bets(user_id,created_at DESC);
CREATE INDEX bets_pending ON bets(match_id) WHERE status='PENDING';
CREATE TABLE ledger (id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),type text NOT NULL CHECK(type IN ('TOPUP','STAKE','PAYOUT','REFUND')),amount bigint NOT NULL CHECK(amount<>0),balance_after bigint NOT NULL CHECK(balance_after BETWEEN 0 AND 9007199254740991),reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,reference),CHECK((type='STAKE')=(amount<0)));
CREATE TABLE match_events (match_id text NOT NULL REFERENCES matches(id),sequence integer NOT NULL CHECK(sequence>0),payload jsonb NOT NULL,PRIMARY KEY(match_id,sequence));
CREATE TABLE jobs (id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('lock','tick','close','open')),entity_id text NOT NULL,run_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),done_at timestamptz,last_error text);
CREATE INDEX jobs_due ON jobs(run_at) WHERE done_at IS NULL;
CREATE TABLE mail_outbox (id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),recipient text NOT NULL,subject text NOT NULL,body text NOT NULL,run_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0,delivered_at timestamptz,provider_id text);
CREATE INDEX mail_due ON mail_outbox(run_at) WHERE delivered_at IS NULL;

CREATE FUNCTION validate_lineup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a jsonb; count_players integer; count_slots integer; count_assigned integer;
BEGIN
 IF NEW.payload->>'formation' NOT IN ('4-3-3','4-2-3-1','4-4-2','3-5-2','3-4-3','5-3-2') OR jsonb_typeof(NEW.payload->'assignments')<>'array' OR jsonb_array_length(NEW.payload->'assignments')<>11 THEN RAISE EXCEPTION 'Invalid lineup'; END IF;
 SELECT count(DISTINCT x->>'playerId'),count(DISTINCT x->>'slotKey'),count(*) INTO count_players,count_slots,count_assigned FROM jsonb_array_elements(NEW.payload->'assignments') x JOIN players p ON p.id=x->>'playerId' AND p.team_id=NEW.team_id;
 IF count_players<>11 OR count_slots<>11 OR count_assigned<>11 THEN RAISE EXCEPTION 'Invalid lineup membership'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lineup_valid BEFORE INSERT OR UPDATE ON lineups FOR EACH ROW EXECUTE FUNCTION validate_lineup();
CREATE FUNCTION protect_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='bets' THEN
  IF OLD.status<>'PENDING' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal bet immutable'; END IF;
  IF (NEW.user_id,NEW.match_id,NEW.quote_id,NEW.stake,NEW.request_id) IS DISTINCT FROM (OLD.user_id,OLD.match_id,OLD.quote_id,OLD.stake,OLD.request_id) THEN RAISE EXCEPTION 'Accepted bet immutable'; END IF;
 ELSE
  IF OLD.status='RESOLVED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Settled fixture immutable'; END IF;
  IF OLD.input IS NOT NULL AND (NEW.input,NEW.seed,NEW.engine_version) IS DISTINCT FROM (OLD.input,OLD.seed,OLD.engine_version) THEN RAISE EXCEPTION 'Frozen input immutable'; END IF;
  IF NEW.revision<OLD.revision THEN RAISE EXCEPTION 'Revision cannot decrease'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bet_terminal BEFORE UPDATE ON bets FOR EACH ROW EXECUTE FUNCTION protect_terminal();
CREATE TRIGGER match_terminal BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION protect_terminal();
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit record immutable'; END $$;
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER immutable_odds BEFORE UPDATE OR DELETE ON odds FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON match_events FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- Defense in depth against direct SQL acceptance after deterministic closure.
CREATE FUNCTION validate_bet() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m matches; r rounds; q odds; manager text;
BEGIN
 SELECT * INTO m FROM matches WHERE id=NEW.match_id FOR UPDATE;
 SELECT * INTO r FROM rounds WHERE id=m.round_id;
 SELECT * INTO q FROM odds WHERE id=NEW.quote_id;
 SELECT id INTO manager FROM teams WHERE manager_id=NEW.user_id AND id IN(m.home_id,m.away_id);
 IF m.status<>'SCHEDULED' OR m.state IS NOT NULL OR clock_timestamp()>=LEAST(r.closes_at,m.scheduled_at) OR r.status<>'OPEN' OR manager IS NOT NULL THEN RAISE EXCEPTION 'Betting closed or own club'; END IF;
 IF q.match_id<>m.id OR q.revision<>(SELECT max(revision) FROM odds WHERE match_id=m.id) THEN RAISE EXCEPTION 'Stale odds'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bet_valid BEFORE INSERT ON bets FOR EACH ROW EXECUTE FUNCTION validate_bet();
