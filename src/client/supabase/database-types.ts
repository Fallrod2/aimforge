export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      ai_usage: {
        Row: {
          coach_count: number;
          day: string;
          routine_count: number;
          user_id: string;
        };
        Insert: {
          coach_count?: number;
          day: string;
          routine_count?: number;
          user_id: string;
        };
        Update: {
          coach_count?: number;
          day?: string;
          routine_count?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      bench_runs: {
        Row: {
          complete: boolean;
          created_at: string;
          date: string;
          id: number;
          overall: number;
          rank: string | null;
          tier: string;
          user_id: string;
        };
        Insert: {
          complete?: boolean;
          created_at?: string;
          date?: string;
          id?: never;
          overall: number;
          rank?: string | null;
          tier: string;
          user_id: string;
        };
        Update: {
          complete?: boolean;
          created_at?: string;
          date?: string;
          id?: never;
          overall?: number;
          rank?: string | null;
          tier?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      debriefs: {
        Row: {
          axes: Json;
          date: string;
          focus: string | null;
          id: number;
          input_raw: string;
          points_forts: Json;
          resume: string;
          user_id: string;
        };
        Insert: {
          axes?: Json;
          date?: string;
          focus?: string | null;
          id?: never;
          input_raw: string;
          points_forts?: Json;
          resume: string;
          user_id: string;
        };
        Update: {
          axes?: Json;
          date?: string;
          focus?: string | null;
          id?: never;
          input_raw?: string;
          points_forts?: Json;
          resume?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          main_agent: string | null;
          notes_maps: string | null;
          objectif: string | null;
          peak: string | null;
          pseudo: string | null;
          rang_valorant: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          main_agent?: string | null;
          notes_maps?: string | null;
          objectif?: string | null;
          peak?: string | null;
          pseudo?: string | null;
          rang_valorant?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          main_agent?: string | null;
          notes_maps?: string | null;
          objectif?: string | null;
          peak?: string | null;
          pseudo?: string | null;
          rang_valorant?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      routines: {
        Row: {
          contenu: Json;
          date: string;
          done: boolean;
          duree_minutes: number;
          focus: string | null;
          id: number;
          user_id: string;
        };
        Insert: {
          contenu: Json;
          date?: string;
          done?: boolean;
          duree_minutes: number;
          focus?: string | null;
          id?: never;
          user_id: string;
        };
        Update: {
          contenu?: Json;
          date?: string;
          done?: boolean;
          duree_minutes?: number;
          focus?: string | null;
          id?: never;
          user_id?: string;
        };
        Relationships: [];
      };
      scenario_scores: {
        Row: {
          energy: number;
          id: number;
          run_id: number;
          scenario: string;
          score: number;
        };
        Insert: {
          energy: number;
          id?: never;
          run_id: number;
          scenario: string;
          score: number;
        };
        Update: {
          energy?: number;
          id?: never;
          run_id?: number;
          scenario?: string;
          score?: number;
        };
        Relationships: [
          {
            foreignKeyName: "scenario_scores_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "bench_runs";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
