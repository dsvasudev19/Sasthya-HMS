-- AlterTable
ALTER TABLE "hms"."medicines" ADD COLUMN     "pack_label" TEXT NOT NULL DEFAULT 'strip',
ADD COLUMN     "pack_size" INTEGER NOT NULL DEFAULT 1;


ALTER TABLE "hms"."medicines" ADD CONSTRAINT "medicines_pack_chk" CHECK (pack_size >= 1 AND pack_size <= 10000);
