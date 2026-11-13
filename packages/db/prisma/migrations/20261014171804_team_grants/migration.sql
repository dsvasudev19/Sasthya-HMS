-- Hospital owners can remove staff memberships. Nothing else on this table is deletable in bulk by other roles' flows.
GRANT DELETE ON "platform"."tenant_memberships" TO "hms_app";
