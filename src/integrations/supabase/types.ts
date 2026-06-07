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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bankroll_historico: {
        Row: {
          banca_atual: number
          banca_inicial: number
          created_at: string
          data: string
          drawdown: number
          id: string
          lucro_acumulado: number
          roi: number
          valor_unidade: number
          yield: number
        }
        Insert: {
          banca_atual: number
          banca_inicial: number
          created_at?: string
          data?: string
          drawdown?: number
          id?: string
          lucro_acumulado?: number
          roi?: number
          valor_unidade: number
          yield?: number
        }
        Update: {
          banca_atual?: number
          banca_inicial?: number
          created_at?: string
          data?: string
          drawdown?: number
          id?: string
          lucro_acumulado?: number
          roi?: number
          valor_unidade?: number
          yield?: number
        }
        Relationships: []
      }
      configuracoes: {
        Row: {
          banca_inicial: number
          created_at: string
          esportes_ativos: string[]
          id: string
          mercados_ativos: string[]
          nome_plataforma: string
          updated_at: string
          valor_unidade_padrao: number
        }
        Insert: {
          banca_inicial?: number
          created_at?: string
          esportes_ativos?: string[]
          id?: string
          mercados_ativos?: string[]
          nome_plataforma?: string
          updated_at?: string
          valor_unidade_padrao?: number
        }
        Update: {
          banca_inicial?: number
          created_at?: string
          esportes_ativos?: string[]
          id?: string
          mercados_ativos?: string[]
          nome_plataforma?: string
          updated_at?: string
          valor_unidade_padrao?: number
        }
        Relationships: []
      }
      prognosticos: {
        Row: {
          created_at: string
          data: string
          edge: number
          esporte: string
          id: string
          jogo: string
          liga: string
          linha: string | null
          lucro_prejuizo: number | null
          mandante: string
          mercado: string
          observacoes: string | null
          odd_ofertada: number
          odd_valor: number
          pick: string
          probabilidade_final: number
          resultado: string
          stake: number
          status_publicacao: string
          status_validacao: string
          updated_at: string
          visitante: string
        }
        Insert: {
          created_at?: string
          data?: string
          edge: number
          esporte: string
          id?: string
          jogo: string
          liga: string
          linha?: string | null
          lucro_prejuizo?: number | null
          mandante: string
          mercado: string
          observacoes?: string | null
          odd_ofertada: number
          odd_valor: number
          pick: string
          probabilidade_final: number
          resultado?: string
          stake?: number
          status_publicacao?: string
          status_validacao?: string
          updated_at?: string
          visitante: string
        }
        Update: {
          created_at?: string
          data?: string
          edge?: number
          esporte?: string
          id?: string
          jogo?: string
          liga?: string
          linha?: string | null
          lucro_prejuizo?: number | null
          mandante?: string
          mercado?: string
          observacoes?: string | null
          odd_ofertada?: number
          odd_valor?: number
          pick?: string
          probabilidade_final?: number
          resultado?: string
          stake?: number
          status_publicacao?: string
          status_validacao?: string
          updated_at?: string
          visitante?: string
        }
        Relationships: []
      }
      resultados: {
        Row: {
          created_at: string
          data_resultado: string
          id: string
          lucro_prejuizo: number
          odd_fechamento: number | null
          placar_final: string | null
          prognostico_id: string
          resultado: string
        }
        Insert: {
          created_at?: string
          data_resultado?: string
          id?: string
          lucro_prejuizo?: number
          odd_fechamento?: number | null
          placar_final?: string | null
          prognostico_id: string
          resultado: string
        }
        Update: {
          created_at?: string
          data_resultado?: string
          id?: string
          lucro_prejuizo?: number
          odd_fechamento?: number | null
          placar_final?: string | null
          prognostico_id?: string
          resultado?: string
        }
        Relationships: [
          {
            foreignKeyName: "resultados_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos"
            referencedColumns: ["id"]
          },
        ]
      }
      validacoes: {
        Row: {
          comentarios_analista: string | null
          created_at: string
          decisao: string
          id: string
          justificativa: string | null
          prognostico_id: string
          riscos_identificados: string | null
          stake_confirmada: number | null
        }
        Insert: {
          comentarios_analista?: string | null
          created_at?: string
          decisao: string
          id?: string
          justificativa?: string | null
          prognostico_id: string
          riscos_identificados?: string | null
          stake_confirmada?: number | null
        }
        Update: {
          comentarios_analista?: string | null
          created_at?: string
          decisao?: string
          id?: string
          justificativa?: string | null
          prognostico_id?: string
          riscos_identificados?: string | null
          stake_confirmada?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "validacoes_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
