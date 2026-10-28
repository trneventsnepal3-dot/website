import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const mediaTypes = {
  popup: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac'],
  hero: ['video/mp4', 'video/webm'],
  event: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  gallery: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};
export const mediaLimits = { popup: 10 * 1024 * 1024, audio: 30 * 1024 * 1024, hero: 100 * 1024 * 1024, event: 10 * 1024 * 1024, gallery: 10 * 1024 * 1024 };
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'video/webm': 'webm' };
export const mediaExtension = type => extensions[type];
export function createStorage(env = process.env, { client: providedClient, sign = getSignedUrl } = {}) {
  const configured = () => ['AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'].every(key => Boolean(env[key]));
  const bucket = kind => ({ popup: env.NEON_MEDIA_BUCKET || 'media', event: env.NEON_MEDIA_BUCKET || 'media', gallery: env.NEON_MEDIA_BUCKET || 'media', audio: env.NEON_SONG_BUCKET || 'song', hero: env.NEON_HERO_BUCKET || 'herosectionvideo' })[kind];
  let client = providedClient;
  function getClient() {
    if (!configured()) throw new Error('Neon object storage credentials are missing.');
    client ||= new S3Client({ endpoint: env.AWS_ENDPOINT_URL_S3, region: env.AWS_REGION, credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }, forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
    return client;
  }
  const publicUrl = (bucketName, key) => `${env.AWS_ENDPOINT_URL_S3.replace(/\/$/, '')}/${encodeURIComponent(bucketName)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return {
    configured, bucket, getClient, publicUrl,
    async authorize({ kind, pathname, contentType, size }) {
      const bucketName = bucket(kind);
      const url = await sign(getClient(), new PutObjectCommand({ Bucket: bucketName, Key: pathname, ContentType: contentType, ContentLength: size, CacheControl: 'public, max-age=31536000, immutable' }), { expiresIn: 600, signableHeaders: new Set(['content-type', 'content-length', 'cache-control']) });
      return { url, method: 'PUT', headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' }, bucket: bucketName };
    },
    async head(bucketName, key) {
      const info = await getClient().send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
      return { url: publicUrl(bucketName, key), contentType: info.ContentType, size: info.ContentLength };
    },
  };
}
