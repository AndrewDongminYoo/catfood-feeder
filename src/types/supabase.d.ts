export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      brands: {
        Row: {
          country: string | null;
          created_at: string;
          homepage_url: string | null;
          id: number;
          importer: string | null;
          ko_name: string;
          manufacturer: string | null;
          name: string;
        };
        Insert: {
          country?: string | null;
          created_at?: string;
          homepage_url?: string | null;
          id?: never;
          importer?: string | null;
          ko_name: string;
          manufacturer?: string | null;
          name: string;
        };
        Update: {
          country?: string | null;
          created_at?: string;
          homepage_url?: string | null;
          id?: never;
          importer?: string | null;
          ko_name?: string;
          manufacturer?: string | null;
          name?: string;
        };
        Relationships: [];
      };
      cats: {
        Row: {
          birth_date: string | null;
          created_at: string;
          id: number;
          name: string;
          owner_id: string;
        };
        Insert: {
          birth_date?: string | null;
          created_at?: string;
          id?: never;
          name: string;
          owner_id: string;
        };
        Update: {
          birth_date?: string | null;
          created_at?: string;
          id?: never;
          name?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      extraction_rate_limits: {
        Row: {
          request_count: number;
          subject: string;
          window_started_at: string;
        };
        Insert: {
          request_count?: number;
          subject: string;
          window_started_at: string;
        };
        Update: {
          request_count?: number;
          subject?: string;
          window_started_at?: string;
        };
        Relationships: [];
      };
      feeding_logs: {
        Row: {
          cat_id: number;
          created_at: string;
          ended_on: string | null;
          food_id: number;
          id: number;
          note: string | null;
          started_on: string;
        };
        Insert: {
          cat_id: number;
          created_at?: string;
          ended_on?: string | null;
          food_id: number;
          id?: never;
          note?: string | null;
          started_on: string;
        };
        Update: {
          cat_id?: number;
          created_at?: string;
          ended_on?: string | null;
          food_id?: number;
          id?: never;
          note?: string | null;
          started_on?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feeding_logs_cat_id_fkey";
            columns: ["cat_id"];
            isOneToOne: false;
            referencedRelation: "cats";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feeding_logs_food_id_fkey";
            columns: ["food_id"];
            isOneToOne: false;
            referencedRelation: "foods";
            referencedColumns: ["id"];
          },
        ];
      };
      food_nutrient_evidence: {
        Row: {
          captured_at: string;
          created_at: string;
          excerpt: string;
          food_id: number;
          id: number;
          is_current: boolean;
          nutrient_key: string;
          source_id: number;
          value: number;
        };
        Insert: {
          captured_at: string;
          created_at?: string;
          excerpt: string;
          food_id: number;
          id?: never;
          is_current?: boolean;
          nutrient_key: string;
          source_id: number;
          value: number;
        };
        Update: {
          captured_at?: string;
          created_at?: string;
          excerpt?: string;
          food_id?: number;
          id?: never;
          is_current?: boolean;
          nutrient_key?: string;
          source_id?: number;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "food_nutrient_evidence_food_id_fkey";
            columns: ["food_id"];
            isOneToOne: false;
            referencedRelation: "foods";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "food_nutrient_evidence_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "food_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      food_research_runs: {
        Row: {
          agent_model: string;
          agent_name: string;
          captures: Json;
          created_at: string;
          evidence_results: Json;
          food_id: number;
          id: number;
          prompt_version: string;
          proposal: Json;
          schema_version: string;
          status: string;
        };
        Insert: {
          agent_model: string;
          agent_name: string;
          captures: Json;
          created_at?: string;
          evidence_results: Json;
          food_id: number;
          id?: never;
          prompt_version: string;
          proposal: Json;
          schema_version: string;
          status: string;
        };
        Update: {
          agent_model?: string;
          agent_name?: string;
          captures?: Json;
          created_at?: string;
          evidence_results?: Json;
          food_id?: number;
          id?: never;
          prompt_version?: string;
          proposal?: Json;
          schema_version?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "food_research_runs_food_id_fkey";
            columns: ["food_id"];
            isOneToOne: false;
            referencedRelation: "foods";
            referencedColumns: ["id"];
          },
        ];
      };
      food_sources: {
        Row: {
          attempted_at: string;
          capture_method: string;
          captured_at: string | null;
          captured_text: string | null;
          content_hash: string | null;
          created_at: string;
          created_by: string | null;
          failure_code: string | null;
          fetch_status: string;
          food_id: number;
          id: number;
          is_current: boolean;
          kind: Database["public"]["Enums"]["nutrient_source"];
          observed_at: string | null;
          url: string;
        };
        Insert: {
          attempted_at?: string;
          capture_method: string;
          captured_at?: string | null;
          captured_text?: string | null;
          content_hash?: string | null;
          created_at?: string;
          created_by?: string | null;
          failure_code?: string | null;
          fetch_status: string;
          food_id: number;
          id?: never;
          is_current?: boolean;
          kind: Database["public"]["Enums"]["nutrient_source"];
          observed_at?: string | null;
          url: string;
        };
        Update: {
          attempted_at?: string;
          capture_method?: string;
          captured_at?: string | null;
          captured_text?: string | null;
          content_hash?: string | null;
          created_at?: string;
          created_by?: string | null;
          failure_code?: string | null;
          fetch_status?: string;
          food_id?: number;
          id?: never;
          is_current?: boolean;
          kind?: Database["public"]["Enums"]["nutrient_source"];
          observed_at?: string | null;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "food_sources_food_id_fkey";
            columns: ["food_id"];
            isOneToOne: false;
            referencedRelation: "foods";
            referencedColumns: ["id"];
          },
        ];
      };
      foods: {
        Row: {
          ash_pct: number | null;
          brand_id: number;
          ca_p_ratio: number | null;
          calcium_pct: number | null;
          carb_is_estimated: boolean;
          carb_pct: number | null;
          caution_ingredients: string[];
          cooking_method: Database["public"]["Enums"]["cooking_method"] | null;
          created_at: string;
          data_verified_at: string | null;
          energy_c_pct: number | null;
          energy_f_pct: number | null;
          energy_p_pct: number | null;
          external_id: string | null;
          fat_pct: number | null;
          fiber_pct: number | null;
          grain_free: boolean;
          has_cranberry: boolean;
          has_probiotics: boolean;
          has_yucca: boolean;
          id: number;
          ingredients: Json;
          kcal_per_kg: number | null;
          kr_label_source: string | null;
          manufacturer_url: string | null;
          meal_free: boolean;
          moisture_pct: number | null;
          nutrient_sources: Json;
          phosphorus_pct: number | null;
          product_name: string;
          protein_pct: number | null;
          published_at: string | null;
          published_by: string | null;
          source: string | null;
          source_conflicts: Json;
          updated_at: string;
          verification_method:
            Database["public"]["Enums"]["food_verification_method"] | null;
          weight_kg: number | null;
        };
        Insert: {
          ash_pct?: number | null;
          brand_id: number;
          ca_p_ratio?: number | null;
          calcium_pct?: number | null;
          carb_is_estimated?: boolean;
          carb_pct?: number | null;
          caution_ingredients?: string[];
          cooking_method?: Database["public"]["Enums"]["cooking_method"] | null;
          created_at?: string;
          data_verified_at?: string | null;
          energy_c_pct?: number | null;
          energy_f_pct?: number | null;
          energy_p_pct?: number | null;
          external_id?: string | null;
          fat_pct?: number | null;
          fiber_pct?: number | null;
          grain_free?: boolean;
          has_cranberry?: boolean;
          has_probiotics?: boolean;
          has_yucca?: boolean;
          id?: never;
          ingredients?: Json;
          kcal_per_kg?: number | null;
          kr_label_source?: string | null;
          manufacturer_url?: string | null;
          meal_free?: boolean;
          moisture_pct?: number | null;
          nutrient_sources?: Json;
          phosphorus_pct?: number | null;
          product_name: string;
          protein_pct?: number | null;
          published_at?: string | null;
          published_by?: string | null;
          source?: string | null;
          source_conflicts?: Json;
          updated_at?: string;
          verification_method?:
            Database["public"]["Enums"]["food_verification_method"] | null;
          weight_kg?: number | null;
        };
        Update: {
          ash_pct?: number | null;
          brand_id?: number;
          ca_p_ratio?: number | null;
          calcium_pct?: number | null;
          carb_is_estimated?: boolean;
          carb_pct?: number | null;
          caution_ingredients?: string[];
          cooking_method?: Database["public"]["Enums"]["cooking_method"] | null;
          created_at?: string;
          data_verified_at?: string | null;
          energy_c_pct?: number | null;
          energy_f_pct?: number | null;
          energy_p_pct?: number | null;
          external_id?: string | null;
          fat_pct?: number | null;
          fiber_pct?: number | null;
          grain_free?: boolean;
          has_cranberry?: boolean;
          has_probiotics?: boolean;
          has_yucca?: boolean;
          id?: never;
          ingredients?: Json;
          kcal_per_kg?: number | null;
          kr_label_source?: string | null;
          manufacturer_url?: string | null;
          meal_free?: boolean;
          moisture_pct?: number | null;
          nutrient_sources?: Json;
          phosphorus_pct?: number | null;
          product_name?: string;
          protein_pct?: number | null;
          published_at?: string | null;
          published_by?: string | null;
          source?: string | null;
          source_conflicts?: Json;
          updated_at?: string;
          verification_method?:
            Database["public"]["Enums"]["food_verification_method"] | null;
          weight_kg?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "foods_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      prices: {
        Row: {
          captured_at: string;
          food_id: number;
          id: number;
          price: number;
          price_per_100g: number | null;
          retailer: string;
          url: string | null;
        };
        Insert: {
          captured_at?: string;
          food_id: number;
          id?: never;
          price: number;
          price_per_100g?: number | null;
          retailer: string;
          url?: string | null;
        };
        Update: {
          captured_at?: string;
          food_id?: number;
          id?: never;
          price?: number;
          price_per_100g?: number | null;
          retailer?: string;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "prices_food_id_fkey";
            columns: ["food_id"];
            isOneToOne: false;
            referencedRelation: "foods";
            referencedColumns: ["id"];
          },
        ];
      };
      recalls: {
        Row: {
          affected_lots: string | null;
          brand_id: number | null;
          classification: string | null;
          created_at: string;
          external_id: string | null;
          food_id: number | null;
          id: number;
          reason: string | null;
          recall_date: string | null;
          recalling_firm: string | null;
          region: string | null;
          source: string;
          source_url: string;
        };
        Insert: {
          affected_lots?: string | null;
          brand_id?: number | null;
          classification?: string | null;
          created_at?: string;
          external_id?: string | null;
          food_id?: number | null;
          id?: never;
          reason?: string | null;
          recall_date?: string | null;
          recalling_firm?: string | null;
          region?: string | null;
          source: string;
          source_url: string;
        };
        Update: {
          affected_lots?: string | null;
          brand_id?: number | null;
          classification?: string | null;
          created_at?: string;
          external_id?: string | null;
          food_id?: number | null;
          id?: never;
          reason?: string | null;
          recall_date?: string | null;
          recalling_firm?: string | null;
          region?: string | null;
          source?: string;
          source_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recalls_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recalls_food_id_fkey";
            columns: ["food_id"];
            isOneToOne: false;
            referencedRelation: "foods";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_food_evidence_draft: {
        Args: {
          p_evidence: Json;
          p_food_id: number;
          p_owned_source_ids?: number[];
        };
        Returns: Json;
      };
      consume_extract_quota: {
        Args: { p_limit: number; p_subject: string; p_window_seconds: number };
        Returns: number;
      };
      publish_food_draft: {
        Args: {
          p_actor_id: string;
          p_derived: Json;
          p_expected_updated_at: string;
          p_food_id: number;
        };
        Returns: Json;
      };
      replace_current_food_source: {
        Args: {
          p_capture_method: string;
          p_captured_at: string;
          p_captured_text: string;
          p_content_hash: string;
          p_created_by?: string;
          p_food_id: number;
          p_kind: Database["public"]["Enums"]["nutrient_source"];
          p_observed_at?: string;
          p_owned_source_ids?: number[];
          p_url: string;
        };
        Returns: {
          claim_status: string;
          content_status: string;
          source_id: number;
        }[];
      };
    };
    Enums: {
      cooking_method: "extrusion" | "baked" | "freeze_dried" | "dried";
      food_verification_method: "legacy_human" | "human";
      nutrient_source: "manufacturer" | "kr_label" | "estimated" | "derived";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      cooking_method: ["extrusion", "baked", "freeze_dried", "dried"],
      food_verification_method: ["legacy_human", "human"],
      nutrient_source: ["manufacturer", "kr_label", "estimated", "derived"],
    },
  },
} as const;
