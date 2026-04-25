import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config/env.js';

cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
});

export function isCloudinaryConfigured() {
  return Boolean(
    config.cloudinaryCloudName &&
      config.cloudinaryApiKey &&
      config.cloudinaryApiSecret
  );
}

export function uploadImageBufferToCloudinary(buffer, opts = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder || 'ticketing/events',
        resource_type: 'image',
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
}

export function extractCloudinaryPublicId(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  try {
    const url = new URL(imageUrl);
    if (!url.hostname.includes('res.cloudinary.com')) return null;

    const pathParts = url.pathname.split('/').filter(Boolean);
    const uploadIndex = pathParts.indexOf('upload');
    if (uploadIndex === -1) return null;

    let publicIdParts = pathParts.slice(uploadIndex + 1);
    if (publicIdParts.length === 0) return null;

    // Skip optional version segment like v1712345678
    if (/^v\d+$/.test(publicIdParts[0])) {
      publicIdParts = publicIdParts.slice(1);
    }
    if (publicIdParts.length === 0) return null;

    const last = publicIdParts[publicIdParts.length - 1];
    publicIdParts[publicIdParts.length - 1] = last.replace(/\.[^/.]+$/, '');
    const publicId = publicIdParts.join('/');
    return publicId || null;
  } catch {
    return null;
  }
}

export async function deleteImageFromCloudinary(publicId) {
  if (!publicId) return { result: 'not_found' };
  return cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}
