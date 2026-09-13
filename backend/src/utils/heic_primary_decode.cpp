#include <cstdio>
#include <libheif/heif.h>

static int fail(const char* message, const heif_error& error) {
  std::fprintf(stderr, "%s: %s\n", message, error.message ? error.message : "unknown error");
  return 1;
}

int main(int argc, char** argv) {
  if (argc != 3) {
    std::fprintf(stderr, "usage: heic-primary-decode INPUT OUTPUT.ppm\n");
    return 2;
  }

  heif_context* context = heif_context_alloc();
  if (!context) return 1;


  heif_error error = heif_context_read_from_file(context, argv[1], nullptr);
  if (error.code != heif_error_Ok) {
    heif_context_free(context);
    return fail("Could not read HEIF", error);
  }

  heif_image_handle* handle = nullptr;
  error = heif_context_get_primary_image_handle(context, &handle);
  if (error.code != heif_error_Ok) {
    heif_context_free(context);
    return fail("Could not select primary HEIF image", error);
  }

  heif_image* image = nullptr;
  error = heif_decode_image(handle, &image, heif_colorspace_RGB, heif_chroma_interleaved_RGB, nullptr);
  if (error.code != heif_error_Ok) {
    heif_image_handle_release(handle);
    heif_context_free(context);
    return fail("Could not decode primary HEIF image", error);
  }

  int stride = 0;
  const uint8_t* pixels = heif_image_get_plane_readonly(image, heif_channel_interleaved, &stride);
  const int width = heif_image_get_width(image, heif_channel_interleaved);
  const int height = heif_image_get_height(image, heif_channel_interleaved);
  if (!pixels || width <= 0 || height <= 0 || stride < static_cast<size_t>(width) * 3) {
    heif_image_release(image);
    heif_image_handle_release(handle);
    heif_context_free(context);
    std::fprintf(stderr, "Decoded primary image has no valid RGB plane\n");
    return 1;
  }

  FILE* output = std::fopen(argv[2], "wb");
  if (!output) {
    heif_image_release(image);
    heif_image_handle_release(handle);
    heif_context_free(context);
    std::perror("Could not open output");
    return 1;
  }

  std::fprintf(output, "P6\n%d %d\n255\n", width, height);
  for (int row = 0; row < height; row++) {
    const size_t rowBytes = static_cast<size_t>(width) * 3;
    if (std::fwrite(pixels + static_cast<size_t>(row) * stride, 1, rowBytes, output) != rowBytes) {
      std::fclose(output);
      heif_image_release(image);
      heif_image_handle_release(handle);
      heif_context_free(context);
      std::fprintf(stderr, "Could not write decoded image\n");
      return 1;
    }
  }

  std::fclose(output);
  heif_image_release(image);
  heif_image_handle_release(handle);
  heif_context_free(context);
  return 0;
}