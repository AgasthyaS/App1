-- ═══════════════════════════════════════════════════════════════════════════
--  15. AUTOMATIC CALIBRATION AND UNCERTAINTY-AWARE WATERING — model versions
--
--  Run after file 14 (supabase/migrations/20261112120000_c3_sensors.sql).
--  Safe to re-run. Changes no table, function or row other than the two
--  model_versions entries below.
--
--  The app now (lib/modelVersion.ts):
--    sensing  s4  works out each sensor's own soil endpoints automatically —
--                 the in-air count measured during setup (firmware c3-1.1
--                 "setup burst"), the in-water count estimated from it and
--                 bounded by the data; and judges the soil from the median of
--                 the last few readings, carried forward along the measured
--                 drying rate, instead of from the newest reading alone.
--    decision d3  weights each logged pour by how well its amount is known
--                 (measured vs a tapped preset), sets aside outlier pours, and
--                 pours up to 40 % less when the answer is uncertain.
--
--  Recommendation rows record the new inputs inside their existing `inputs`
--  jsonb (soil_sd, soil_readings_used, ml_per_point_sd_log, …), so no column
--  is added.
-- ═══════════════════════════════════════════════════════════════════════════

do $guard$
begin
  if to_regclass('public.model_versions') is null then
    raise exception 'Run supabase/migrations/20261112000000_platform.sql first.';
  end if;
end
$guard$;

insert into public.model_versions (component, version, description) values
  ('sensing',  's4', 'Automatic per-sensor soil endpoints (air measured at setup, water estimated and bounded by data); soil level = median of recent readings carried forward along the measured drying rate.'),
  ('decision', 'd3', 'Pours weighted by how well their amount is known, outliers set aside, and the dose reduced by up to 40 % when uncertain (factor e^(-0.5·sigma)).')
on conflict (component, version) do nothing;
