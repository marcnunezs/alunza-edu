-- IMP-05.06: one administrative observation, independent of history pagination.
-- STABLE fixes authorization and all rule projections to the caller's statement
-- snapshot. observedAt is observation time, not a signal evaluation checkpoint.
create function app_private.effective_signal_rules(org uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare response jsonb;
begin
 if app_private.can_admin(org,true) is distinct from true
  or not app_private.session_is_active(app_private.actor_id(),nullif(current_setting('app.session_id',true),'')::uuid)
  or (app_private.organization_id() is not null and app_private.organization_id()<>org) then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select jsonb_build_object(
  'organizationId',org,
  'observedAt',app_private.signal_rule_instant(statement_timestamp()),
  'rules',jsonb_agg(jsonb_build_object(
   'type',k.kind,
   'ruleVersion',case when v.id is null then null else app_private.signal_rule_projection(v) end
  ) order by k.position)
 ) into response
 from (values(1,'INACTIVITY'),(2,'REPEATED_ERROR'),(3,'STAGNATION')) as k(position,kind)
 left join app.signal_rule_versions v on v.organization_id=org and v.type=k.kind
  and v.valid_from is not null and v.valid_to is null;
 return response;
end $$;

-- Reuse the constrained owner from .03; never grant browser or service-role RPC.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
alter function app_private.effective_signal_rules(uuid) owner to alunza_identity;
revoke all on function app_private.effective_signal_rules(uuid) from public,anon,authenticated,service_role,alunza_app;
grant execute on function app_private.effective_signal_rules(uuid) to alunza_identity,alunza_app;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
