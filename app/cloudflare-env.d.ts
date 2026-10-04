declare namespace Cloudflare {
  interface Env {
    AI_API_KEY?: string;
    AI_BASE_URL?: string;
    AI_MODEL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    GOOGLE_API_KEY?: string;
    GOOGLE_MODEL?: string;
    EXA_API_KEY?: string;
    KERNEL_API_KEY?: string;
    FLY_API_TOKEN?: string;
    NOOK_REGISTRATION_KEY?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
