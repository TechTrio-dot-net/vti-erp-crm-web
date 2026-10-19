import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // The backend (src/server, served from src/pages/api) uses these Node packages as they are, without bundling
  serverExternalPackages: ["pg", "express", "multer", "compression", "jsonwebtoken", "bcryptjs", "resend"],
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-label",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
      "@radix-ui/react-avatar",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-toast",
    ],
  },
};

export default nextConfig;
