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
      app_config: {
        Row: {
          id: number
          signup_mode: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          signup_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          signup_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      budget_categories: {
        Row: {
          budgeted: number
          created_at: string
          end_month: string | null
          group: string
          household_id: string
          id: string
          name: string
          notes_required: boolean
          slug: string
          sort_order: number
          start_month: string | null
        }
        Insert: {
          budgeted?: number
          created_at?: string
          end_month?: string | null
          group: string
          household_id: string
          id?: string
          name: string
          notes_required?: boolean
          slug: string
          sort_order?: number
          start_month?: string | null
        }
        Update: {
          budgeted?: number
          created_at?: string
          end_month?: string | null
          group?: string
          household_id?: string
          id?: string
          name?: string
          notes_required?: boolean
          slug?: string
          sort_order?: number
          start_month?: string | null
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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      financial_profiles: {
        Row: {
          annual_gross_income: number
          created_at: string
          debts: Json
          dependents: Json
          emergency_fund_balance: number | null
          estimated_home_value: number | null
          filing_status: string
          has_life_insurance: boolean | null
          household_id: string
          housing_type: string
          id: string
          income_type: string
          lease_end_date: string | null
          life_insurance_coverage: number | null
          life_insurance_coverages: Json
          member_incomes: Json
          monthly_additions_per_key: Json | null
          monthly_rent: number | null
          mortgage_balance: number | null
          mortgage_breakdown_enabled: boolean | null
          mortgage_escrow: number | null
          mortgage_extra: number | null
          mortgage_loan_type: string | null
          mortgage_payment: number | null
          mortgage_pi: number | null
          mortgage_rate: number | null
          mortgage_statement_month: string | null
          non_retirement_investments: number | null
          non_retirement_per_member: Json
          renters_insurance: boolean | null
          renters_insurance_premium: number | null
          retirement_balance: number | null
          retirement_balance_per_member: Json
          roth_balance_per_member: Json
          roth_retirement_balance: number | null
          state: string | null
          total_investment_balance: number | null
          updated_at: string
        }
        Insert: {
          annual_gross_income?: number
          created_at?: string
          debts?: Json
          dependents?: Json
          emergency_fund_balance?: number | null
          estimated_home_value?: number | null
          filing_status?: string
          has_life_insurance?: boolean | null
          household_id: string
          housing_type?: string
          id?: string
          income_type?: string
          lease_end_date?: string | null
          life_insurance_coverage?: number | null
          life_insurance_coverages?: Json
          member_incomes?: Json
          monthly_additions_per_key?: Json | null
          monthly_rent?: number | null
          mortgage_balance?: number | null
          mortgage_breakdown_enabled?: boolean | null
          mortgage_escrow?: number | null
          mortgage_extra?: number | null
          mortgage_loan_type?: string | null
          mortgage_payment?: number | null
          mortgage_pi?: number | null
          mortgage_rate?: number | null
          mortgage_statement_month?: string | null
          non_retirement_investments?: number | null
          non_retirement_per_member?: Json
          renters_insurance?: boolean | null
          renters_insurance_premium?: number | null
          retirement_balance?: number | null
          retirement_balance_per_member?: Json
          roth_balance_per_member?: Json
          roth_retirement_balance?: number | null
          state?: string | null
          total_investment_balance?: number | null
          updated_at?: string
        }
        Update: {
          annual_gross_income?: number
          created_at?: string
          debts?: Json
          dependents?: Json
          emergency_fund_balance?: number | null
          estimated_home_value?: number | null
          filing_status?: string
          has_life_insurance?: boolean | null
          household_id?: string
          housing_type?: string
          id?: string
          income_type?: string
          lease_end_date?: string | null
          life_insurance_coverage?: number | null
          life_insurance_coverages?: Json
          member_incomes?: Json
          monthly_additions_per_key?: Json | null
          monthly_rent?: number | null
          mortgage_balance?: number | null
          mortgage_breakdown_enabled?: boolean | null
          mortgage_escrow?: number | null
          mortgage_extra?: number | null
          mortgage_loan_type?: string | null
          mortgage_payment?: number | null
          mortgage_pi?: number | null
          mortgage_rate?: number | null
          mortgage_statement_month?: string | null
          non_retirement_investments?: number | null
          non_retirement_per_member?: Json
          renters_insurance?: boolean | null
          renters_insurance_premium?: number | null
          retirement_balance?: number | null
          retirement_balance_per_member?: Json
          roth_balance_per_member?: Json
          roth_retirement_balance?: number | null
          state?: string | null
          total_investment_balance?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      fixed_expenses: {
        Row: {
          amount: number
          created_at: string
          end_month: string | null
          group: string
          household_id: string
          id: string
          name: string
          notes_required: boolean
          slug: string
          sort_order: number
          start_month: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          end_month?: string | null
          group: string
          household_id: string
          id?: string
          name: string
          notes_required?: boolean
          slug: string
          sort_order?: number
          start_month?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          end_month?: string | null
          group?: string
          household_id?: string
          id?: string
          name?: string
          notes_required?: boolean
          slug?: string
          sort_order?: number
          start_month?: string | null
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
      invites: {
        Row: {
          code: string
          created_at: string
          created_by: string
          email: string | null
          expires_at: string
          household_id: string | null
          id: string
          revoked_at: string | null
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          email?: string | null
          expires_at?: string
          household_id?: string | null
          id?: string
          revoked_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          email?: string | null
          expires_at?: string
          household_id?: string | null
          id?: string
          revoked_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      mfa_attempt_log: {
        Row: {
          attempt_type: string
          created_at: string
          id: string
          ip_address: string | null
          success: boolean
          user_id: string
        }
        Insert: {
          attempt_type: string
          created_at?: string
          id?: string
          ip_address?: string | null
          success: boolean
          user_id: string
        }
        Update: {
          attempt_type?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          success?: boolean
          user_id?: string
        }
        Relationships: []
      }
      mfa_audit_log: {
        Row: {
          created_at: string
          event: Database["public"]["Enums"]["mfa_audit_event"]
          id: string
          ip_address: string | null
          metadata: Json
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event: Database["public"]["Enums"]["mfa_audit_event"]
          id?: string
          ip_address?: string | null
          metadata?: Json
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event?: Database["public"]["Enums"]["mfa_audit_event"]
          id?: string
          ip_address?: string | null
          metadata?: Json
          user_agent?: string | null
          user_id?: string
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
          access_token: string | null
          created_at: string
          cursor: string | null
          household_id: string
          id: string
          institution_name: string
          item_id: string
          last_successful_sync_at: string | null
          last_sync_attempt_at: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          requires_reconnect: boolean
          sync_failure_count: number
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          cursor?: string | null
          household_id: string
          id?: string
          institution_name?: string
          item_id: string
          last_successful_sync_at?: string | null
          last_sync_attempt_at?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          requires_reconnect?: boolean
          sync_failure_count?: number
        }
        Update: {
          access_token?: string | null
          created_at?: string
          cursor?: string | null
          household_id?: string
          id?: string
          institution_name?: string
          item_id?: string
          last_successful_sync_at?: string | null
          last_sync_attempt_at?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          requires_reconnect?: boolean
          sync_failure_count?: number
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
      plaid_tokens: {
        Row: {
          access_token: string
          created_at: string
          id: string
          plaid_item_id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          plaid_item_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          plaid_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_tokens_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: true
            referencedRelation: "plaid_items"
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
          last_seen_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_initial?: string
          created_at?: string
          display_name: string
          household_id: string
          id?: string
          last_seen_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_initial?: string
          created_at?: string
          display_name?: string
          household_id?: string
          id?: string
          last_seen_at?: string | null
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
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      tool_states: {
        Row: {
          household_id: string
          id: string
          state_json: Json
          tool_name: string
          updated_at: string
        }
        Insert: {
          household_id: string
          id?: string
          state_json?: Json
          tool_name: string
          updated_at?: string
        }
        Update: {
          household_id?: string
          id?: string
          state_json?: Json
          tool_name?: string
          updated_at?: string
        }
        Relationships: []
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
      user_mfa_recovery_codes: {
        Row: {
          code_hash: string
          consumed_at: string | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          household_id: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          household_id?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          household_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_household_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_current_household_admin: { Args: never; Returns: boolean }
      is_household_admin: {
        Args: { _household_id: string; _user_id: string }
        Returns: boolean
      }
      is_system_admin: { Args: { _user_id: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recent_failed_mfa_attempts: {
        Args: { _user_id: string; _window_minutes?: number }
        Returns: number
      }
      validate_invite_code: {
        Args: { _code: string; _email?: string }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "member"
        | "system_admin"
        | "household_admin"
        | "household_member"
      mfa_audit_event:
        | "enroll_started"
        | "enroll_verified"
        | "enroll_failed"
        | "verify_success"
        | "verify_failed"
        | "disabled"
        | "recovery_code_used"
        | "recovery_codes_regenerated"
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
      app_role: [
        "admin",
        "member",
        "system_admin",
        "household_admin",
        "household_member",
      ],
      mfa_audit_event: [
        "enroll_started",
        "enroll_verified",
        "enroll_failed",
        "verify_success",
        "verify_failed",
        "disabled",
        "recovery_code_used",
        "recovery_codes_regenerated",
      ],
    },
  },
} as const
