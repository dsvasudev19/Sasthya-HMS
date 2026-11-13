-- AddForeignKey
ALTER TABLE "hms"."appointments" ADD CONSTRAINT "appointments_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "hms"."branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
