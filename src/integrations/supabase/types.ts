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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      budget_categories: {
        Row: {
          budgeted: number
          created_at: string
          group: string
          household_id: string
          id: string
          name: string
          notes_required: boolean
          slug: string
          sort_order: number
        }
        Insert: {
          budgeted?: number
          created_at?: string
          group: string
          household_id: string
          id?: string
          name: string
          notes_required?: boolean
          slug: string
          sort_order?: number
        }
        Update: {
          budgeted?: number
          created_at?: string
          group?: string
          household_id?: string
          id?: string
          name?: string
          notes_required?: boolean
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_month_snapshots: {
        Row: {
          categories: Json
          created_at: string
          fixed_expenses: Json
          household_id: string
          id: string
          month: string
          transactions_summary: Json
          transfers: Json
        }
        Insert: {
          categories?: Json
          created_at?: string
          fixed_expenses?: Json
          household_id: string
          id?: string
          month: string
          transactions_summary?: Json
          transfers?: Json
        }
        Update: {
          categories?: Json
          created_at?: string
          fixed_expenses?: Json
          household_id?: string
          id?: string
          month?: string
          transactions_summary?: Json
          transfers?: Json
        }
        Relationships: [
          {
            foreignKeyName: "budget_month_snapshots_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_transfers: {
        Row: {
          amount: number
          created_at: string
          date: string
          from_category_slug: string
          household_id: string
          id: string
          to_category_slug: string
        }
        Insert: {
          amount: number
          created_at?: string
          date?: string
          from_category_slug: string
          household_id: string
          id?: string
          to_category_slug: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          from_category_slug?: string
          household_id?: string
          id?: string
          to_category_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_transfers_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_expenses: {
        Row: {
          amount: number
          created_at: string
          group: string
          household_id: string
          id: string
          name: string
          notes_required: boolean
          slug: string
          sort_order: number
        }
        Insert: {
          amount?: number
          created_at?: string
          group: string
          household_id: string
          id?: string
          name: string
          notes_required?: boolean
          slug: string
          sort_order?: number
        }
        Update: {
          amount?: number
          created_at?: string
          group?: string
          household_id?: string
          id?: string
          name?: string
          notes_required?: boolean
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "fixed_expenses_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          active_month: string
          created_at: string
          id: string
          name: string
          planning_data: Json
        }
        Insert: {
          active_month?: string
          created_at?: string
          id?: string
          name?: string
          planning_data?: Json
        }
        Update: {
          active_month?: string
          created_at?: string
          id?: string
          name?: string
          planning_data?: Json
        }
        Relationships: []
      }
      plaid_accounts: {
        Row: {
          account_category: string
          app_account: string | null
          created_at: string
          household_id: string
          id: string
          mask: string | null
          name: string
          nickname: string | null
          official_name: string | null
          plaid_account_id: string
          plaid_item_id: string
          subtype: string | null
          type: string
        }
        Insert: {
          account_category?: string
          app_account?: string | null
          created_at?: string
          household_id: string
          id?: string
          mask?: string | null
          name?: string
          nickname?: string | null
          official_name?: string | null
          plaid_account_id: string
          plaid_item_id: string
          subtype?: string | null
          type?: string
        }
        Update: {
          account_category?: string
          app_account?: string | null
          created_at?: string
          household_id?: string
          id?: string
          mask?: string | null
          name?: string
          nickname?: string | null
          official_name?: string | null
          plaid_account_id?: string
          plaid_item_id?: string
          subtype?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_accounts_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_cardholders: {
        Row: {
          created_at: string
          household_id: string
          id: string
          match_patterns: string[]
          name: string
          plaid_account_id: string
          slug: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          match_patterns?: string[]
          name: string
          plaid_account_id: string
          slug: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          match_patterns?: string[]
          name?: string
          plaid_account_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_cardholders_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_cardholders_plaid_account_id_fkey"
            columns: ["plaid_account_id"]
            isOneToOne: false
            referencedRelation: "plaid_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_items: {
        Row: {
          access_token: string
          created_at: string
          cursor: string | null
          household_id: string
          id: string
          institution_name: string
          item_id: string
          last_synced_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string
          cursor?: string | null
          household_id: string
          id?: string
          institution_name?: string
          item_id: string
          last_synced_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string
          cursor?: string | null
          household_id?: string
          id?: string
          institution_name?: string
          item_id?: string
          last_synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plaid_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_initial: string
          created_at: string
          display_name: string
          household_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_initial?: string
          created_at?: string
          display_name: string
          household_id: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_initial?: string
          created_at?: string
          display_name?: string
          household_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account: string
          amount: number
          budget_month: string
          category_slug: string
          created_at: string
          date: string
          description: string
          entered_by: string | null
          household_id: string
          id: string
          is_transfer_to_savings: boolean
          notes: string
          plaid_transaction_id: string | null
          transaction_type: string
        }
        Insert: {
          account: string
          amount: number
          budget_month?: string
          category_slug: string
          created_at?: string
          date?: string
          description?: string
          entered_by?: string | null
          household_id: string
          id?: string
          is_transfer_to_savings?: boolean
          notes?: string
          plaid_transaction_id?: string | null
          transaction_type?: string
        }
        Update: {
          account?: string
          amount?: number
          budget_month?: string
          category_slug?: string
          created_at?: string
          date?: string
          description?: string
          entered_by?: string | null
          household_id?: string
          id?: string
          is_transfer_to_savings?: boolean
          notes?: string
          plaid_transaction_id?: string | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_household_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "member"
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
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const
