CREATE OR REPLACE FUNCTION validate_lineup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text[]; count_players integer; count_slots integer; count_assigned integer;
BEGIN
 expected := CASE NEW.payload->>'formation'
 WHEN '4-3-3' THEN ARRAY['GK','LB','LCB','RCB','RB','LCM','CM','RCM','LW','ST','RW']
 WHEN '4-2-3-1' THEN ARRAY['GK','LB','LCB','RCB','RB','LCDM','RCDM','LM','CAM','RM','ST']
 WHEN '4-4-2' THEN ARRAY['GK','LB','LCB','RCB','RB','LM','LCM','RCM','RM','LST','RST']
 WHEN '3-5-2' THEN ARRAY['GK','LCB','CB','RCB','LM','LCM','CDM','RCM','RM','LST','RST']
 WHEN '3-4-3' THEN ARRAY['GK','LCB','CB','RCB','LM','LCM','RCM','RM','LW','ST','RW']
 WHEN '5-3-2' THEN ARRAY['GK','LB','LCB','CB','RCB','RB','LCM','CM','RCM','LST','RST'] END;
 IF expected IS NULL OR jsonb_typeof(NEW.payload->'assignments') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.payload->'assignments')<>11 THEN RAISE EXCEPTION 'Invalid lineup'; END IF;
 SELECT count(DISTINCT x->>'playerId'),count(DISTINCT x->>'slotKey'),count(*) INTO count_players,count_slots,count_assigned
 FROM jsonb_array_elements(NEW.payload->'assignments') x JOIN players p ON p.id=x->>'playerId' AND p.team_id=NEW.team_id
 WHERE x->>'slotKey'=ANY(expected) AND ((x->>'slotKey'='GK')=(p.payload->>'primaryPosition'='GK'));
 IF count_players<>11 OR count_slots<>11 OR count_assigned<>11 THEN RAISE EXCEPTION 'Invalid lineup membership or slots'; END IF;
 IF TG_OP='UPDATE' AND NEW.kind='official' AND NEW.payload IS DISTINCT FROM OLD.payload AND EXISTS(SELECT 1 FROM matches WHERE status='SCHEDULED' AND (home_id=NEW.team_id OR away_id=NEW.team_id) AND lineup_locks_at<=clock_timestamp()) THEN RAISE EXCEPTION 'Official lineup locked'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION validate_bet() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m matches; r rounds; q odds; manager text;
BEGIN
 SELECT * INTO m FROM matches WHERE id=NEW.match_id FOR UPDATE;
 SELECT * INTO r FROM rounds WHERE id=m.round_id;
 SELECT * INTO q FROM odds WHERE id=NEW.quote_id;
 SELECT id INTO manager FROM teams WHERE manager_id=NEW.user_id AND id IN(m.home_id,m.away_id);
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND deactivated_at IS NULL) OR m.status<>'SCHEDULED' OR m.state IS NOT NULL OR clock_timestamp()<r.opens_at OR clock_timestamp()>=LEAST(r.closes_at,m.scheduled_at) OR r.status<>'OPEN' OR manager IS NOT NULL THEN RAISE EXCEPTION 'Betting closed or own club'; END IF;
 IF q.match_id<>m.id OR q.revision<>(SELECT max(revision) FROM odds WHERE match_id=m.id) THEN RAISE EXCEPTION 'Stale odds'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE odds ADD CONSTRAINT selection_valid CHECK(
 (market='MATCH_RESULT' AND selection IN ('HOME','DRAW','AWAY')) OR
 (market='EXACT_SCORE' AND (selection ~ '^[0-3]-[0-3]$' OR selection='OTHER')) OR
 (market IN ('TOTAL_CARDS','TOTAL_CORNERS') AND selection IN ('UNDER','OVER')));
ALTER TABLE bets ADD CONSTRAINT losing_payout_zero CHECK(status<>'LOST' OR payout=0);
CREATE FUNCTION wallet_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account text; actual bigint; total numeric;
BEGIN
 IF TG_TABLE_NAME='users' THEN account:=NEW.id; ELSE account:=NEW.user_id; END IF;
 SELECT balance INTO actual FROM users WHERE id=account;
 SELECT coalesce(sum(amount),0) INTO total FROM ledger WHERE user_id=account;
 IF actual IS DISTINCT FROM total THEN RAISE EXCEPTION 'Wallet and ledger differ'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER user_wallet_consistency AFTER INSERT OR UPDATE ON users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_consistent();
CREATE CONSTRAINT TRIGGER ledger_wallet_consistency AFTER INSERT ON ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_consistent();
CREATE FUNCTION bet_ledger_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_bet bets;
BEGIN
 SELECT * INTO current_bet FROM bets WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM ledger WHERE user_id=current_bet.user_id AND reference='bet:'||current_bet.id||':stake' AND amount=-current_bet.stake AND type='STAKE') THEN RAISE EXCEPTION 'Stake ledger required'; END IF;
 IF current_bet.status='CANCELLED' AND NOT EXISTS(SELECT 1 FROM ledger WHERE user_id=current_bet.user_id AND reference='bet:'||current_bet.id||':refund' AND amount=current_bet.stake AND type='REFUND') THEN RAISE EXCEPTION 'Refund ledger required'; END IF;
 IF current_bet.status='WON' AND current_bet.payout>0 AND NOT EXISTS(SELECT 1 FROM ledger WHERE user_id=current_bet.user_id AND reference='bet:'||current_bet.id||':payout' AND amount=current_bet.payout AND type='PAYOUT') THEN RAISE EXCEPTION 'Payout ledger required'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bet_ledger_consistency AFTER INSERT OR UPDATE ON bets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bet_ledger_consistent();
CREATE FUNCTION valid_match_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='RESOLVED' AND (
  NEW.state->>'phase' IS DISTINCT FROM 'FINISHED' OR
  NEW.result IS DISTINCT FROM jsonb_build_object('homeScore',NEW.state#>'{home,stats,goals}','awayScore',NEW.state#>'{away,stats,goals}','homeCards',NEW.state#>'{home,stats,cards}','awayCards',NEW.state#>'{away,stats,cards}','homeCorners',NEW.state#>'{home,stats,corners}','awayCorners',NEW.state#>'{away,stats,corners}')
 ) THEN RAISE EXCEPTION 'Result requires a matching full-time checkpoint'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER match_resolution BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION valid_match_resolution();
