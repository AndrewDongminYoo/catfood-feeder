import { type NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  images: {
    unoptimized: true,
  },
  typedRoutes: true,
};

export default nextConfig;
