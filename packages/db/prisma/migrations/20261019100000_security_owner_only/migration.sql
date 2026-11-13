UPDATE "platform"."tenant_roles" SET "permissions" = array_remove("permissions", 'security:manage') WHERE "is_system" AND "key" = 'ADMIN';
