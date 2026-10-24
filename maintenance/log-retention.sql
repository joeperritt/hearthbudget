-- SQL-only hourly cron command, installed as hourly-log-cleanup (0 * * * *).
SET default_transaction_read_only TO 'off';
SET statement_timeout TO '45s';
SET lock_timeout TO '5s';
DO $cleanup$
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '1 day';
  DELETE FROM net._http_response WHERE created < now() - interval '1 hour';
  IF pg_total_relation_size('cron.job_run_details') > 100000000 THEN
    TRUNCATE TABLE cron.job_run_details;
  END IF;
END
$cleanup$;