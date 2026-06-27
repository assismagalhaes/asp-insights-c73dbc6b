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
      asp_validator_registros: {
        Row: {
          adjusted_ev: number | null
          adjusted_fair_odd: number | null
          adjusted_probability: number | null
          against_blocks: string[]
          alerts: string[]
          analysis_context: string | null
          away_team: string
          clv: number | null
          confidence: string
          created_at: string
          decision: string
          favorable_blocks: string[]
          final_analysis: string
          home_team: string
          id: string
          league: string | null
          line: string | null
          market: string
          match_date: string | null
          ocr_raw_text: string | null
          offered_odd: number | null
          online_context_json: Json
          pick: string
          profit_brl: number | null
          profit_units: number | null
          result_status: string | null
          simulation_json: Json
          source_ev: number | null
          source_fair_odd: number | null
          source_platform: string
          source_probability: number | null
          sport: string
          stake_units: number | null
          structured_error: string | null
          structured_json: Json
          structured_status: string
          updated_at: string
          user_context: string | null
          user_id: string
          validator_model: string
        }
        Insert: {
          adjusted_ev?: number | null
          adjusted_fair_odd?: number | null
          adjusted_probability?: number | null
          against_blocks?: string[]
          alerts?: string[]
          analysis_context?: string | null
          away_team: string
          clv?: number | null
          confidence: string
          created_at?: string
          decision: string
          favorable_blocks?: string[]
          final_analysis: string
          home_team: string
          id?: string
          league?: string | null
          line?: string | null
          market: string
          match_date?: string | null
          ocr_raw_text?: string | null
          offered_odd?: number | null
          online_context_json?: Json
          pick: string
          profit_brl?: number | null
          profit_units?: number | null
          result_status?: string | null
          simulation_json?: Json
          source_ev?: number | null
          source_fair_odd?: number | null
          source_platform: string
          source_probability?: number | null
          sport: string
          stake_units?: number | null
          structured_error?: string | null
          structured_json?: Json
          structured_status?: string
          updated_at?: string
          user_context?: string | null
          user_id?: string
          validator_model: string
        }
        Update: {
          adjusted_ev?: number | null
          adjusted_fair_odd?: number | null
          adjusted_probability?: number | null
          against_blocks?: string[]
          alerts?: string[]
          analysis_context?: string | null
          away_team?: string
          clv?: number | null
          confidence?: string
          created_at?: string
          decision?: string
          favorable_blocks?: string[]
          final_analysis?: string
          home_team?: string
          id?: string
          league?: string | null
          line?: string | null
          market?: string
          match_date?: string | null
          ocr_raw_text?: string | null
          offered_odd?: number | null
          online_context_json?: Json
          pick?: string
          profit_brl?: number | null
          profit_units?: number | null
          result_status?: string | null
          simulation_json?: Json
          source_ev?: number | null
          source_fair_odd?: number | null
          source_platform?: string
          source_probability?: number | null
          sport?: string
          stake_units?: number | null
          structured_error?: string | null
          structured_json?: Json
          structured_status?: string
          updated_at?: string
          user_context?: string | null
          user_id?: string
          validator_model?: string
        }
        Relationships: []
      }
      asp_validator_uploads: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string | null
          id: string
          mime_type: string | null
          ocr_error: string | null
          ocr_status: string
          ocr_text: string | null
          structured_error: string | null
          structured_json: Json | null
          structured_status: string
          updated_at: string
          upload_category: string
          upload_order: number
          user_comment: string | null
          user_id: string
          validator_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          mime_type?: string | null
          ocr_error?: string | null
          ocr_status?: string
          ocr_text?: string | null
          structured_error?: string | null
          structured_json?: Json | null
          structured_status?: string
          updated_at?: string
          upload_category: string
          upload_order?: number
          user_comment?: string | null
          user_id?: string
          validator_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          mime_type?: string | null
          ocr_error?: string | null
          ocr_status?: string
          ocr_text?: string | null
          structured_error?: string | null
          structured_json?: Json | null
          structured_status?: string
          updated_at?: string
          upload_category?: string
          upload_order?: number
          user_comment?: string | null
          user_id?: string
          validator_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asp_validator_uploads_validator_id_fkey"
            columns: ["validator_id"]
            isOneToOne: false
            referencedRelation: "asp_validator_registros"
            referencedColumns: ["id"]
          },
        ]
      }
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
      coletas_odds: {
        Row: {
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          erro: string | null
          esporte: string | null
          id: string
          job_id: string | null
          liga: string | null
          mercados: Json | null
          normalized_json: Json | null
          parametros: Json | null
          raw_json: Json | null
          status: string
          total_jogos: number
          total_odds: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          erro?: string | null
          esporte?: string | null
          id?: string
          job_id?: string | null
          liga?: string | null
          mercados?: Json | null
          normalized_json?: Json | null
          parametros?: Json | null
          raw_json?: Json | null
          status?: string
          total_jogos?: number
          total_odds?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          erro?: string | null
          esporte?: string | null
          id?: string
          job_id?: string | null
          liga?: string | null
          mercados?: Json | null
          normalized_json?: Json | null
          parametros?: Json | null
          raw_json?: Json | null
          status?: string
          total_jogos?: number
          total_odds?: number
          updated_at?: string
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
          percentual_unidade: number
          tipo_stake: string
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
          percentual_unidade?: number
          tipo_stake?: string
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
          percentual_unidade?: number
          tipo_stake?: string
          updated_at?: string
          valor_unidade_padrao?: number
        }
        Relationships: []
      }
      ligas: {
        Row: {
          ativo: boolean
          created_at: string
          esporte: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          esporte: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          esporte?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      odds_jogos: {
        Row: {
          bookmaker: string | null
          capturado_em: string | null
          coleta_id: string | null
          created_at: string
          data: string | null
          esporte: string | null
          fonte: string | null
          hora: string | null
          id: string
          jogo: string | null
          liga: string | null
          linha: string | null
          mandante: string | null
          mercado: string | null
          odd: number | null
          pick: string | null
          raw_ref: Json | null
          visitante: string | null
        }
        Insert: {
          bookmaker?: string | null
          capturado_em?: string | null
          coleta_id?: string | null
          created_at?: string
          data?: string | null
          esporte?: string | null
          fonte?: string | null
          hora?: string | null
          id?: string
          jogo?: string | null
          liga?: string | null
          linha?: string | null
          mandante?: string | null
          mercado?: string | null
          odd?: number | null
          pick?: string | null
          raw_ref?: Json | null
          visitante?: string | null
        }
        Update: {
          bookmaker?: string | null
          capturado_em?: string | null
          coleta_id?: string | null
          created_at?: string
          data?: string | null
          esporte?: string | null
          fonte?: string | null
          hora?: string | null
          id?: string
          jogo?: string | null
          liga?: string | null
          linha?: string | null
          mandante?: string | null
          mercado?: string | null
          odd?: number | null
          pick?: string | null
          raw_ref?: Json | null
          visitante?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "odds_jogos_coleta_id_fkey"
            columns: ["coleta_id"]
            isOneToOne: false
            referencedRelation: "coletas_odds"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          nome: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          nome?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          nome?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prognosticos: {
        Row: {
          canal_publicacao: string | null
          created_at: string
          dados_tecnicos: string | null
          data: string
          data_publicacao: string | null
          edge: number
          edge_ajustado: number | null
          esporte: string
          hora: string | null
          id: string
          jogo: string
          liga: string
          linha: string | null
          lucro_prejuizo: number | null
          mandante: string
          mercado: string
          observacoes: string | null
          odd_ajustada: number | null
          odd_ofertada: number
          odd_valor: number
          pick: string
          probabilidade_final: number
          publicado_em: string | null
          publicado_por: string | null
          resultado: string
          stake: number
          status_publicacao: string
          status_validacao: string
          tip_texto: string | null
          updated_at: string
          visitante: string
        }
        Insert: {
          canal_publicacao?: string | null
          created_at?: string
          dados_tecnicos?: string | null
          data?: string
          data_publicacao?: string | null
          edge: number
          edge_ajustado?: number | null
          esporte: string
          hora?: string | null
          id?: string
          jogo: string
          liga: string
          linha?: string | null
          lucro_prejuizo?: number | null
          mandante: string
          mercado: string
          observacoes?: string | null
          odd_ajustada?: number | null
          odd_ofertada: number
          odd_valor: number
          pick: string
          probabilidade_final: number
          publicado_em?: string | null
          publicado_por?: string | null
          resultado?: string
          stake?: number
          status_publicacao?: string
          status_validacao?: string
          tip_texto?: string | null
          updated_at?: string
          visitante: string
        }
        Update: {
          canal_publicacao?: string | null
          created_at?: string
          dados_tecnicos?: string | null
          data?: string
          data_publicacao?: string | null
          edge?: number
          edge_ajustado?: number | null
          esporte?: string
          hora?: string | null
          id?: string
          jogo?: string
          liga?: string
          linha?: string | null
          lucro_prejuizo?: number | null
          mandante?: string
          mercado?: string
          observacoes?: string | null
          odd_ajustada?: number | null
          odd_ofertada?: number
          odd_valor?: number
          pick?: string
          probabilidade_final?: number
          publicado_em?: string | null
          publicado_por?: string | null
          resultado?: string
          stake?: number
          status_publicacao?: string
          status_validacao?: string
          tip_texto?: string | null
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      validacoes: {
        Row: {
          buscas_realizadas: Json | null
          comentarios_analista: string | null
          contexto_adicional: string | null
          created_at: string
          data_analise_ia: string | null
          decisao: string
          decisao_ia_sugerida: string | null
          fontes_consultadas: Json | null
          id: string
          justificativa: string | null
          modo_ia: string | null
          parecer_ia: string | null
          parecer_validacao: string | null
          prognostico_id: string
          prompt_versao: string | null
          riscos_identificados: string | null
          stake_confirmada: number | null
          stake_ia_sugerida: number | null
        }
        Insert: {
          buscas_realizadas?: Json | null
          comentarios_analista?: string | null
          contexto_adicional?: string | null
          created_at?: string
          data_analise_ia?: string | null
          decisao: string
          decisao_ia_sugerida?: string | null
          fontes_consultadas?: Json | null
          id?: string
          justificativa?: string | null
          modo_ia?: string | null
          parecer_ia?: string | null
          parecer_validacao?: string | null
          prognostico_id: string
          prompt_versao?: string | null
          riscos_identificados?: string | null
          stake_confirmada?: number | null
          stake_ia_sugerida?: number | null
        }
        Update: {
          buscas_realizadas?: Json | null
          comentarios_analista?: string | null
          contexto_adicional?: string | null
          created_at?: string
          data_analise_ia?: string | null
          decisao?: string
          decisao_ia_sugerida?: string | null
          fontes_consultadas?: Json | null
          id?: string
          justificativa?: string | null
          modo_ia?: string | null
          parecer_ia?: string | null
          parecer_validacao?: string | null
          prognostico_id?: string
          prompt_versao?: string | null
          riscos_identificados?: string | null
          stake_confirmada?: number | null
          stake_ia_sugerida?: number | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
