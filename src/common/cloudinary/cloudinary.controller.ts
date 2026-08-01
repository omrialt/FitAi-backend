import {
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from './cloudinary.service';

// Both routes were previously unguarded, which made the project's Cloudinary
// account writable by anyone on the internet who found the URL. Any signed-in
// account may upload, so authentication alone is the right bar here — a
// @Roles() listing every role would be noise (and RolesGuard only reads
// handler-level metadata anyway, so a class-level one would never fire).
@Controller('upload')
@UseGuards(AuthGuard('jwt'))
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  /**
   * Upload a single image
   * POST /upload
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
      },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const imageUrl = await this.cloudinaryService.uploadImage(file);

    return {
      success: true,
      imageUrl,
      message: 'Image uploaded successfully',
    };
  }

  /**
   * Upload multiple images
   * POST /upload/multiple
   */
  @Post('multiple')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      // Max 10 files
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB per file
      },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadMultipleImages(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const imageUrls = await this.cloudinaryService.uploadMultipleImages(files);

    return {
      success: true,
      imageUrls,
      count: imageUrls.length,
      message: 'Images uploaded successfully',
    };
  }
}
