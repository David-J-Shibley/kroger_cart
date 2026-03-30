export interface KrogerProduct {
  upc: string;
  productId: string;
  name: string;
  price: number;
}

/** Product + full raw response from Kroger API (for metadata display). */
export interface PickerProduct extends KrogerProduct {
  raw?: Record<string, unknown>;
}

export interface KrogerCartItem {
  product: { name: string; price: number };
  quantity: number;
}

export interface KrogerCartResponse {
  items?: KrogerCartItem[];
  code?: string;
  message?: string;
}

export interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** One line of NDJSON from POST …/api/chat (Featherless proxy shape). */
export interface LlmStreamLine {
  message?: { content?: string };
}
