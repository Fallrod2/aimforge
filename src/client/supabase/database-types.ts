export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_settings: {
        Row: {
          api_key: string
          base_url: string | null
          model: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          base_url?: string | null
          model: string
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          base_url?: string | null
          model?: string
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          chat_count: number
          coach_count: number
          day: string
          routine_count: number
          user_id: string
        }
        Insert: {
          chat_count?: number
          coach_count?: number
          day: string
          routine_count?: number
          user_id: string
        }
        Update: {
          chat_count?: number
          coach_count?: number
          day?: string
          routine_count?: number
          user_id?: string
        }
        Relationships: []
      }
      bench_runs: {
        Row: {
          complete: boolean
          created_at: string
          date: string
          id: number
          overall: number
          rank: string | null
          season: string
          source: string
          tier: string
          user_id: string
        }
        Insert: {
          complete?: boolean
          created_at?: string
          date?: string
          id?: never
          overall: number
          rank?: string | null
          season?: string
          source?: string
          tier: string
          user_id: string
        }
        Update: {
          complete?: boolean
          created_at?: string
          date?: string
          id?: never
          overall?: number
          rank?: string | null
          season?: string
          source?: string
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      coach_messages: {
        Row: {
          content: string
          created_at: string
          debrief_id: number
          id: number
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          debrief_id: number
          id?: never
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          debrief_id?: number
          id?: never
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_messages_debrief_id_fkey"
            columns: ["debrief_id"]
            isOneToOne: false
            referencedRelation: "debriefs"
            referencedColumns: ["id"]
          },
        ]
      }
      debriefs: {
        Row: {
          axes: Json
          date: string
          focus: string | null
          id: number
          input_raw: string
          match_id: string | null
          points_forts: Json
          resume: string
          user_id: string
        }
        Insert: {
          axes?: Json
          date?: string
          focus?: string | null
          id?: never
          input_raw: string
          match_id?: string | null
          points_forts?: Json
          resume: string
          user_id: string
        }
        Update: {
          axes?: Json
          date?: string
          focus?: string | null
          id?: never
          input_raw?: string
          match_id?: string | null
          points_forts?: Json
          resume?: string
          user_id?: string
        }
        Relationships: []
      }
      import_usage: {
        Row: {
          day: string
          kovaaks_count: number
          riot_link_count: number
          user_id: string
        }
        Insert: {
          day: string
          kovaaks_count?: number
          riot_link_count?: number
          user_id: string
        }
        Update: {
          day?: string
          kovaaks_count?: number
          riot_link_count?: number
          user_id?: string
        }
        Relationships: []
      }
      imported_matches: {
        Row: {
          created_at: string
          id: number
          linked_account_id: number
          match_id: string
          payload: Json
          played_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          linked_account_id: number
          match_id: string
          payload?: Json
          played_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          linked_account_id?: number
          match_id?: string
          payload?: Json
          played_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_matches_linked_account_id_fkey"
            columns: ["linked_account_id"]
            isOneToOne: false
            referencedRelation: "linked_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      linked_accounts: {
        Row: {
          created_at: string
          external_id: string
          id: number
          is_primary: boolean
          label: string | null
          last_refreshed_at: string | null
          provider: string
          riot_mmr: Json | null
          riot_puuid: string | null
          riot_region: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          external_id: string
          id?: never
          is_primary?: boolean
          label?: string | null
          last_refreshed_at?: string | null
          provider: string
          riot_mmr?: Json | null
          riot_puuid?: string | null
          riot_region?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          external_id?: string
          id?: never
          is_primary?: boolean
          label?: string | null
          last_refreshed_at?: string | null
          provider?: string
          riot_mmr?: Json | null
          riot_puuid?: string | null
          riot_region?: string | null
          user_id?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          ai_api_key: string | null
          ai_base_url: string | null
          ai_global_daily_limit: number | null
          ai_model: string | null
          ai_provider: string | null
          coach_daily: number
          henrikdev_api_key: string | null
          id: number
          kovaaks_import_daily: number
          riot_link_daily: number
          routine_daily: number
          updated_at: string
        }
        Insert: {
          ai_api_key?: string | null
          ai_base_url?: string | null
          ai_global_daily_limit?: number | null
          ai_model?: string | null
          ai_provider?: string | null
          coach_daily?: number
          henrikdev_api_key?: string | null
          id: number
          kovaaks_import_daily?: number
          riot_link_daily?: number
          routine_daily?: number
          updated_at?: string
        }
        Update: {
          ai_api_key?: string | null
          ai_base_url?: string | null
          ai_global_daily_limit?: number | null
          ai_model?: string | null
          ai_provider?: string | null
          coach_daily?: number
          henrikdev_api_key?: string | null
          id?: number
          kovaaks_import_daily?: number
          riot_link_daily?: number
          routine_daily?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          main_agent: string | null
          notes_maps: string | null
          objectif: string | null
          peak: string | null
          pseudo: string | null
          rang_valorant: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          main_agent?: string | null
          notes_maps?: string | null
          objectif?: string | null
          peak?: string | null
          pseudo?: string | null
          rang_valorant?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          main_agent?: string | null
          notes_maps?: string | null
          objectif?: string | null
          peak?: string | null
          pseudo?: string | null
          rang_valorant?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      routines: {
        Row: {
          contenu: Json
          date: string
          done: boolean
          duree_minutes: number
          focus: string | null
          id: number
          user_id: string
        }
        Insert: {
          contenu: Json
          date?: string
          done?: boolean
          duree_minutes: number
          focus?: string | null
          id?: never
          user_id: string
        }
        Update: {
          contenu?: Json
          date?: string
          done?: boolean
          duree_minutes?: number
          focus?: string | null
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      scenario_scores: {
        Row: {
          energy: number
          id: number
          run_id: number
          scenario: string
          score: number
        }
        Insert: {
          energy: number
          id?: never
          run_id: number
          scenario: string
          score: number
        }
        Update: {
          energy?: number
          id?: never
          run_id?: number
          scenario?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "scenario_scores_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "bench_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_ai_usage: {
        Args: { p_kind: string; p_user_id: string }
        Returns: number
      }
      increment_import_usage: {
        Args: { p_kind: string; p_user_id: string }
        Returns: number
      }
      platform_ai_usage_today: { Args: never; Returns: number }
      refund_ai_usage: {
        Args: { p_kind: string; p_user_id: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
