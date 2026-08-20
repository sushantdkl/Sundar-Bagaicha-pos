/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [],
  },
  async rewrites() {
    return [
      // Uploaded images (UPLOADS_DIR) via media route — /uploads/menu/*.jpg in prod.
      {
        source: '/uploads/:path*',
        destination: '/api/media/:path*',
      },
    ];
  },
};

export default nextConfig;
