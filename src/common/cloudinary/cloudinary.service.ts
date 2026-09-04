import { Injectable, BadRequestException } from '@nestjs/common';
import {
  v2 as cloudinary,
  UploadApiResponse,
  UploadApiErrorResponse,
} from 'cloudinary';
import { Readable } from 'stream';

@Injectable()
export class CloudinaryService {
  /**
   * Upload an image to Cloudinary
   * @param file - Express.Multer.File object
   * @returns Promise<string> - URL of the uploaded image
   */
  async uploadImage(file: Express.Multer.File): Promise<string> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    // Validate file type
    const mimetype = (file as { mimetype?: string }).mimetype;
    if (!mimetype || !mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'fitai/uploads',
          resource_type: 'image',
          transformation: [
            { width: 2000, crop: 'limit' }, // Limit max width
            { quality: 'auto' }, // Auto quality optimization
            { fetch_format: 'auto' }, // Auto format (WebP, etc.)
          ],
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error) {
            reject(new BadRequestException(`Upload failed: ${error.message}`));
          } else if (result) {
            resolve(result.secure_url);
          } else {
            reject(
              new BadRequestException('Upload failed: No result returned'),
            );
          }
        },
      );

      // Convert buffer to stream and pipe to Cloudinary
      const bufferStream = new Readable();
      const buffer = (file as { buffer?: Buffer }).buffer;
      if (buffer) {
        bufferStream.push(buffer);
      }
      bufferStream.push(null);
      bufferStream.pipe(uploadStream);
    });
  }

  /**
   * Upload an image nobody can fetch without a signature.
   *
   * `uploadImage` above returns a `secure_url` that works for anyone who has
   * it — Cloudinary's default `upload` type is public delivery, and the only
   * thing protecting one of those assets is that its URL is hard to guess.
   * That is an acceptable bar for a progress-plan thumbnail and not one for a
   * photograph of somebody's body.
   *
   * `type: 'authenticated'` changes the delivery rule rather than the storage:
   * the asset 401s unless the request carries a signature derived from the
   * account secret, which only this server can produce. So the URL stops being
   * public and starts being something the app hands out per viewer.
   *
   * Returns the identifier rather than a URL on purpose. A URL implies "here,
   * show this"; a `publicId` has to be turned into one by `signedUrl`, which
   * is where the permission check belongs and where it cannot be skipped by
   * accident.
   */
  async uploadPrivateImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<{ publicId: string; version: number; width?: number; height?: number }> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const mimetype = (file as { mimetype?: string }).mimetype;
    if (!mimetype || !mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          type: 'authenticated',
          transformation: [
            { width: 1600, crop: 'limit' },
            { quality: 'auto' },
            { fetch_format: 'auto' },
          ],
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error) {
            reject(new BadRequestException(`Upload failed: ${error.message}`));
          } else if (result) {
            resolve({
              publicId: result.public_id,
              version: result.version,
              width: result.width,
              height: result.height,
            });
          } else {
            reject(new BadRequestException('Upload failed: No result returned'));
          }
        },
      );

      const bufferStream = new Readable();
      const buffer = (file as { buffer?: Buffer }).buffer;
      if (buffer) {
        bufferStream.push(buffer);
      }
      bufferStream.push(null);
      bufferStream.pipe(uploadStream);
    });
  }

  /**
   * A delivery URL for an authenticated asset.
   *
   * Worth being precise about what this is and is not. The signature proves
   * the URL was minted by something holding the account secret; it does not
   * carry an identity and it does not expire on its own. So a signed URL is a
   * **bearer capability** — whoever holds the string can fetch the image until
   * the asset is deleted.
   *
   * That is why callers must check permission before asking for one, and why
   * these are minted per request rather than stored on the document. Storing
   * one would turn a revocable permission into a permanent link, which is the
   * whole failure this feature was supposed to avoid. Deleting the asset is
   * what actually revokes access, and `deleteImage` handles that.
   *
   * A short-lived token would be better still. Cloudinary's `auth_token`
   * mechanism does exactly that and requires a plan this project is not on, so
   * this is the strongest option available here and its limit is documented
   * rather than glossed.
   */
  signedUrl(publicId: string, version?: number): string {
    return cloudinary.url(publicId, {
      type: 'authenticated',
      sign_url: true,
      secure: true,
      ...(version ? { version } : {}),
    });
  }

  /**
   * Delete an image from Cloudinary by public_id
   * @param publicId - The public ID of the image to delete
   * @returns Promise<void>
   */
  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(`Failed to delete image: ${message}`);
    }
  }

  /**
   * Upload multiple images
   * @param files - Array of Express.Multer.File objects
   * @returns Promise<string[]> - Array of uploaded image URLs
   */
  async uploadMultipleImages(files: Express.Multer.File[]): Promise<string[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const uploadPromises = files.map((file) => this.uploadImage(file));
    return Promise.all(uploadPromises);
  }
}
