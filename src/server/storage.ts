import "server-only";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { storedFiles } from "./db/schema";
import { env } from "./env";

let client: S3Client | undefined;

/** Stockage objet actif (Neon Object Storage) ; sinon les fichiers vont en base. */
export function objectStorageConfigured(): boolean {
  const e = env();
  return !!(e.AWS_ENDPOINT_URL_S3 && e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY);
}

function s3(): S3Client {
  // Identifiants, point d'accès et région viennent des variables AWS standard injectées par Neon.
  client ??= new S3Client({ forcePathStyle: true, region: process.env.AWS_REGION ?? "us-east-2" });
  return client;
}

export async function putFile(
  database: Db,
  organizationId: string,
  key: string,
  bytes: Buffer,
  contentType: string,
) {
  if (objectStorageConfigured()) {
    await s3().send(
      new PutObjectCommand({
        Bucket: env().RECEIPTS_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    return;
  }
  await database
    .insert(storedFiles)
    .values({ key, organizationId, contentType, bytes })
    .onConflictDoNothing();
}

export async function getFile(
  database: Db,
  organizationId: string,
  key: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  // La clé commence par l'organisation : on ne lit jamais le fichier d'une autre.
  if (!key.startsWith(`${organizationId}/`)) return null;
  // Fichiers déposés avant l'activation du stockage objet : ils restent en base, lus d'abord là.
  const [row] = await database.select().from(storedFiles).where(eq(storedFiles.key, key));
  if (row) {
    return row.organizationId === organizationId
      ? { bytes: row.bytes, contentType: row.contentType }
      : null;
  }
  if (!objectStorageConfigured()) return null;
  const res = await s3().send(new GetObjectCommand({ Bucket: env().RECEIPTS_BUCKET, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  return bytes
    ? { bytes: Buffer.from(bytes), contentType: res.ContentType ?? "application/octet-stream" }
    : null;
}
