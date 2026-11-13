-- One-time, cluster-level bootstrap (roles and an empty database).
-- Everything inside the database (schemas, tables, RLS, grants) is created by Prisma migrations only.
-- Run with: psql -d postgres -v migrator_pw=... -v app_pw=... -f infra/postgres/bootstrap.sql

SELECT format('CREATE ROLE hms_migrator LOGIN CREATEDB PASSWORD %L', :'migrator_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_migrator') \gexec

SELECT format('CREATE ROLE hms_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_app') \gexec

SELECT 'CREATE DATABASE swasthya_hms OWNER hms_migrator'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'swasthya_hms') \gexec

REVOKE ALL ON DATABASE swasthya_hms FROM PUBLIC;
GRANT CONNECT ON DATABASE swasthya_hms TO hms_app;

\connect swasthya_hms
-- No object may live in public: remove the default schema entirely.
DROP SCHEMA IF EXISTS public CASCADE;

\connect postgres
-- Throwaway database Prisma uses to compute migrations (dev only).
SELECT 'CREATE DATABASE swasthya_hms_shadow OWNER hms_migrator'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'swasthya_hms_shadow') \gexec
