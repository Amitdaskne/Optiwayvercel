/**
 * Cloudinary Unsigned Image Upload Helper
 * Cloud Name: dlsiskxua
 * Upload Preset: ml_default
 */

const CLOUDINARY_CLOUD_NAME = "dlsiskxua";
const CLOUDINARY_UPLOAD_PRESET = "ml_default";
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

export interface UploadProgressCallback {
  (progressPercent: number): void;
}

export async function uploadImageToCloudinary(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Please select a valid image file."));
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error("Image size must be less than 10MB."));
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", UPLOAD_URL, true);

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          if (response.secure_url) {
            resolve(response.secure_url);
          } else {
            reject(new Error("Cloudinary did not return a valid image URL."));
          }
        } catch (err) {
          reject(new Error("Failed to parse image upload response."));
        }
      } else {
        reject(new Error(`Image upload failed with status ${xhr.status}. Please check network connection.`));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during image upload. Please try again."));
    };

    xhr.send(formData);
  });
}
