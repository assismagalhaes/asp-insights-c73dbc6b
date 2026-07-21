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
      analises_ia: {
        Row: {
          buscas_realizadas: Json | null
          contexto_analisado: string | null
          created_at: string
          data_evento: string | null
          decisao_sugerida: string | null
          edge_usado: number | null
          esporte: string | null
          fontes_consultadas: Json | null
          hora_evento: string | null
          id: string
          jogo: string | null
          liga: string | null
          linha: string | null
          mercado: string | null
          modo_ia: string
          odd_usada: number | null
          parecer_ia: string | null
          pick: string | null
          probabilidade_final: number | null
          prognostico_id: string | null
          prompt_versao: string | null
          riscos_identificados: string | null
          stake_sugerida: number | null
          tags_risco: Json | null
          updated_at: string
          validacao_id: string | null
        }
        Insert: {
          buscas_realizadas?: Json | null
          contexto_analisado?: string | null
          created_at?: string
          data_evento?: string | null
          decisao_sugerida?: string | null
          edge_usado?: number | null
          esporte?: string | null
          fontes_consultadas?: Json | null
          hora_evento?: string | null
          id?: string
          jogo?: string | null
          liga?: string | null
          linha?: string | null
          mercado?: string | null
          modo_ia?: string
          odd_usada?: number | null
          parecer_ia?: string | null
          pick?: string | null
          probabilidade_final?: number | null
          prognostico_id?: string | null
          prompt_versao?: string | null
          riscos_identificados?: string | null
          stake_sugerida?: number | null
          tags_risco?: Json | null
          updated_at?: string
          validacao_id?: string | null
        }
        Update: {
          buscas_realizadas?: Json | null
          contexto_analisado?: string | null
          created_at?: string
          data_evento?: string | null
          decisao_sugerida?: string | null
          edge_usado?: number | null
          esporte?: string | null
          fontes_consultadas?: Json | null
          hora_evento?: string | null
          id?: string
          jogo?: string | null
          liga?: string | null
          linha?: string | null
          mercado?: string | null
          modo_ia?: string
          odd_usada?: number | null
          parecer_ia?: string | null
          pick?: string | null
          probabilidade_final?: number | null
          prognostico_id?: string | null
          prompt_versao?: string | null
          riscos_identificados?: string | null
          stake_sugerida?: number | null
          tags_risco?: Json | null
          updated_at?: string
          validacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analises_ia_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analises_ia_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos_clv"
            referencedColumns: ["prognostico_id"]
          },
        ]
      }
      asp_screener_mlb_daily_snapshots: {
        Row: {
          analyze_count: number | null
          created_at: string
          execution_summary: Json
          filters_payload: Json
          games_count: number | null
          handicap_rows_count: number | null
          id: string
          metadata: Json
          missing_data_count: number | null
          moneyline_rows_count: number | null
          monitor_count: number | null
          odds_rows_count: number | null
          run_id: string
          season: number | null
          shortlist_primary_count: number | null
          skip_count: number | null
          snapshot_date: string
          source_league: string
          source_module: string
          source_sport: string
          standings_snapshot_date: string | null
          standings_source: string | null
          status: string
          totals_rows_count: number | null
          unified_opportunities_count: number | null
          unsupported_line_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          analyze_count?: number | null
          created_at?: string
          execution_summary?: Json
          filters_payload?: Json
          games_count?: number | null
          handicap_rows_count?: number | null
          id?: string
          metadata?: Json
          missing_data_count?: number | null
          moneyline_rows_count?: number | null
          monitor_count?: number | null
          odds_rows_count?: number | null
          run_id: string
          season?: number | null
          shortlist_primary_count?: number | null
          skip_count?: number | null
          snapshot_date: string
          source_league?: string
          source_module?: string
          source_sport?: string
          standings_snapshot_date?: string | null
          standings_source?: string | null
          status?: string
          totals_rows_count?: number | null
          unified_opportunities_count?: number | null
          unsupported_line_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          analyze_count?: number | null
          created_at?: string
          execution_summary?: Json
          filters_payload?: Json
          games_count?: number | null
          handicap_rows_count?: number | null
          id?: string
          metadata?: Json
          missing_data_count?: number | null
          moneyline_rows_count?: number | null
          monitor_count?: number | null
          odds_rows_count?: number | null
          run_id?: string
          season?: number | null
          shortlist_primary_count?: number | null
          skip_count?: number | null
          snapshot_date?: string
          source_league?: string
          source_module?: string
          source_sport?: string
          standings_snapshot_date?: string | null
          standings_source?: string | null
          status?: string
          totals_rows_count?: number | null
          unified_opportunities_count?: number | null
          unsupported_line_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      asp_screener_mlb_opportunity_snapshots: {
        Row: {
          alerts: Json
          away_team: string | null
          base_candidate_status: string | null
          bookmaker: string | null
          confidence_score: number | null
          correlated_with: string | null
          correlation_group_id: string | null
          correlation_status: string | null
          created_at: string
          daily_snapshot_id: string
          distance_from_main_line: number | null
          ev: number | null
          event_date: string | null
          event_time: string | null
          fair_odd: number | null
          game_id: string | null
          handoff_id: string | null
          home_team: string | null
          id: string
          is_main_line: boolean | null
          is_primary_shortlist: boolean | null
          line: string | null
          line_type: string | null
          market_family: string | null
          market_label: string | null
          market_prob_no_vig: number | null
          matchup: string | null
          metadata: Json
          model_prob: number | null
          offered_odd: number | null
          opportunity_id: string
          opportunity_payload: Json
          opportunity_score: number | null
          pick_label: string | null
          priority_status: string | null
          probability_edge: number | null
          projection_status: string | null
          rank: number | null
          reasons: Json
          risk_flags: Json
          run_id: string
          selection_team: string | null
          sent_to_validator: boolean
          side: string | null
          source_projection_payload: Json
          updated_at: string
          user_id: string
          validator_decision: string | null
          validator_record_id: string | null
        }
        Insert: {
          alerts?: Json
          away_team?: string | null
          base_candidate_status?: string | null
          bookmaker?: string | null
          confidence_score?: number | null
          correlated_with?: string | null
          correlation_group_id?: string | null
          correlation_status?: string | null
          created_at?: string
          daily_snapshot_id: string
          distance_from_main_line?: number | null
          ev?: number | null
          event_date?: string | null
          event_time?: string | null
          fair_odd?: number | null
          game_id?: string | null
          handoff_id?: string | null
          home_team?: string | null
          id?: string
          is_main_line?: boolean | null
          is_primary_shortlist?: boolean | null
          line?: string | null
          line_type?: string | null
          market_family?: string | null
          market_label?: string | null
          market_prob_no_vig?: number | null
          matchup?: string | null
          metadata?: Json
          model_prob?: number | null
          offered_odd?: number | null
          opportunity_id: string
          opportunity_payload?: Json
          opportunity_score?: number | null
          pick_label?: string | null
          priority_status?: string | null
          probability_edge?: number | null
          projection_status?: string | null
          rank?: number | null
          reasons?: Json
          risk_flags?: Json
          run_id: string
          selection_team?: string | null
          sent_to_validator?: boolean
          side?: string | null
          source_projection_payload?: Json
          updated_at?: string
          user_id?: string
          validator_decision?: string | null
          validator_record_id?: string | null
        }
        Update: {
          alerts?: Json
          away_team?: string | null
          base_candidate_status?: string | null
          bookmaker?: string | null
          confidence_score?: number | null
          correlated_with?: string | null
          correlation_group_id?: string | null
          correlation_status?: string | null
          created_at?: string
          daily_snapshot_id?: string
          distance_from_main_line?: number | null
          ev?: number | null
          event_date?: string | null
          event_time?: string | null
          fair_odd?: number | null
          game_id?: string | null
          handoff_id?: string | null
          home_team?: string | null
          id?: string
          is_main_line?: boolean | null
          is_primary_shortlist?: boolean | null
          line?: string | null
          line_type?: string | null
          market_family?: string | null
          market_label?: string | null
          market_prob_no_vig?: number | null
          matchup?: string | null
          metadata?: Json
          model_prob?: number | null
          offered_odd?: number | null
          opportunity_id?: string
          opportunity_payload?: Json
          opportunity_score?: number | null
          pick_label?: string | null
          priority_status?: string | null
          probability_edge?: number | null
          projection_status?: string | null
          rank?: number | null
          reasons?: Json
          risk_flags?: Json
          run_id?: string
          selection_team?: string | null
          sent_to_validator?: boolean
          side?: string | null
          source_projection_payload?: Json
          updated_at?: string
          user_id?: string
          validator_decision?: string | null
          validator_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asp_screener_mlb_opportunity_snapshots_daily_snapshot_id_fkey"
            columns: ["daily_snapshot_id"]
            isOneToOne: false
            referencedRelation: "asp_screener_mlb_daily_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      asp_screener_validator_handoffs: {
        Row: {
          alignment_score: number | null
          alignment_status: string | null
          applied_at: string | null
          away_team: string | null
          bookmaker: string | null
          confidence_score: number | null
          created_at: string
          critical_payload: Json
          discarded_at: string | null
          ev: number | null
          event_date: string | null
          event_time: string | null
          expires_at: string | null
          fair_odd: number | null
          game_id: string | null
          handoff_id: string
          handoff_payload: Json
          handoff_version: string | null
          home_team: string | null
          id: string
          line: string | null
          market: string | null
          market_probability_no_vig: number | null
          matchup: string | null
          metadata: Json
          model_probability: number | null
          odd: number | null
          opportunity_payload: Json
          opportunity_score: number | null
          pick: string | null
          priority_status: string | null
          readiness_status: string | null
          sent_at: string | null
          source_league: string
          source_module: string
          source_sport: string
          source_stage: string | null
          status: string
          updated_at: string
          user_id: string
          validation_completed_at: string | null
          validation_started_at: string | null
          validator_adjusted_probability: number | null
          validator_context_payload: Json
          validator_decision: string | null
          validator_final_ev: number | null
          validator_reason: string | null
          validator_record_id: string | null
        }
        Insert: {
          alignment_score?: number | null
          alignment_status?: string | null
          applied_at?: string | null
          away_team?: string | null
          bookmaker?: string | null
          confidence_score?: number | null
          created_at?: string
          critical_payload?: Json
          discarded_at?: string | null
          ev?: number | null
          event_date?: string | null
          event_time?: string | null
          expires_at?: string | null
          fair_odd?: number | null
          game_id?: string | null
          handoff_id: string
          handoff_payload?: Json
          handoff_version?: string | null
          home_team?: string | null
          id?: string
          line?: string | null
          market?: string | null
          market_probability_no_vig?: number | null
          matchup?: string | null
          metadata?: Json
          model_probability?: number | null
          odd?: number | null
          opportunity_payload?: Json
          opportunity_score?: number | null
          pick?: string | null
          priority_status?: string | null
          readiness_status?: string | null
          sent_at?: string | null
          source_league?: string
          source_module?: string
          source_sport?: string
          source_stage?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          validation_completed_at?: string | null
          validation_started_at?: string | null
          validator_adjusted_probability?: number | null
          validator_context_payload?: Json
          validator_decision?: string | null
          validator_final_ev?: number | null
          validator_reason?: string | null
          validator_record_id?: string | null
        }
        Update: {
          alignment_score?: number | null
          alignment_status?: string | null
          applied_at?: string | null
          away_team?: string | null
          bookmaker?: string | null
          confidence_score?: number | null
          created_at?: string
          critical_payload?: Json
          discarded_at?: string | null
          ev?: number | null
          event_date?: string | null
          event_time?: string | null
          expires_at?: string | null
          fair_odd?: number | null
          game_id?: string | null
          handoff_id?: string
          handoff_payload?: Json
          handoff_version?: string | null
          home_team?: string | null
          id?: string
          line?: string | null
          market?: string | null
          market_probability_no_vig?: number | null
          matchup?: string | null
          metadata?: Json
          model_probability?: number | null
          odd?: number | null
          opportunity_payload?: Json
          opportunity_score?: number | null
          pick?: string | null
          priority_status?: string | null
          readiness_status?: string | null
          sent_at?: string | null
          source_league?: string
          source_module?: string
          source_sport?: string
          source_stage?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          validation_completed_at?: string | null
          validation_started_at?: string | null
          validator_adjusted_probability?: number | null
          validator_context_payload?: Json
          validator_decision?: string | null
          validator_final_ev?: number | null
          validator_reason?: string | null
          validator_record_id?: string | null
        }
        Relationships: []
      }
      asp_validator_registros: {
        Row: {
          adjusted_ev: number | null
          adjusted_fair_odd: number | null
          adjusted_probability: number | null
          against_blocks: string[]
          alerts: string[]
          analysis_context: string | null
          away_team: string
          bankroll_applied: boolean
          clv: number | null
          confidence: string
          created_at: string
          decision: string
          favorable_blocks: string[]
          final_analysis: string
          final_score: string | null
          home_team: string
          id: string
          is_simulated_result: boolean
          league: string | null
          line: string | null
          market: string
          match_date: string | null
          ocr_data_quality_score: number | null
          ocr_raw_text: string | null
          ocr_structured_data: Json | null
          ocr_structured_fields_count: number | null
          offered_odd: number | null
          online_context_json: Json
          pick: string
          profit_brl: number | null
          profit_units: number | null
          result_notes: string | null
          result_settled_at: string | null
          result_status: string | null
          simulation_json: Json
          simulation_type: string | null
          source_ev: number | null
          source_fair_odd: number | null
          source_platform: string
          source_probability: number | null
          sport: string
          stake_units: number | null
          structured_error: string | null
          structured_json: Json
          structured_status: string
          unit_value_brl: number | null
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
          bankroll_applied?: boolean
          clv?: number | null
          confidence: string
          created_at?: string
          decision: string
          favorable_blocks?: string[]
          final_analysis: string
          final_score?: string | null
          home_team: string
          id?: string
          is_simulated_result?: boolean
          league?: string | null
          line?: string | null
          market: string
          match_date?: string | null
          ocr_data_quality_score?: number | null
          ocr_raw_text?: string | null
          ocr_structured_data?: Json | null
          ocr_structured_fields_count?: number | null
          offered_odd?: number | null
          online_context_json?: Json
          pick: string
          profit_brl?: number | null
          profit_units?: number | null
          result_notes?: string | null
          result_settled_at?: string | null
          result_status?: string | null
          simulation_json?: Json
          simulation_type?: string | null
          source_ev?: number | null
          source_fair_odd?: number | null
          source_platform: string
          source_probability?: number | null
          sport: string
          stake_units?: number | null
          structured_error?: string | null
          structured_json?: Json
          structured_status?: string
          unit_value_brl?: number | null
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
          bankroll_applied?: boolean
          clv?: number | null
          confidence?: string
          created_at?: string
          decision?: string
          favorable_blocks?: string[]
          final_analysis?: string
          final_score?: string | null
          home_team?: string
          id?: string
          is_simulated_result?: boolean
          league?: string | null
          line?: string | null
          market?: string
          match_date?: string | null
          ocr_data_quality_score?: number | null
          ocr_raw_text?: string | null
          ocr_structured_data?: Json | null
          ocr_structured_fields_count?: number | null
          offered_odd?: number | null
          online_context_json?: Json
          pick?: string
          profit_brl?: number | null
          profit_units?: number | null
          result_notes?: string | null
          result_settled_at?: string | null
          result_status?: string | null
          simulation_json?: Json
          simulation_type?: string | null
          source_ev?: number | null
          source_fair_odd?: number | null
          source_platform?: string
          source_probability?: number | null
          sport?: string
          stake_units?: number | null
          structured_error?: string | null
          structured_json?: Json
          structured_status?: string
          unit_value_brl?: number | null
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
          file_path: string | null
          file_size: number | null
          file_type: string | null
          id: string
          mime_type: string | null
          ocr_data_quality_score: number | null
          ocr_error: string | null
          ocr_status: string
          ocr_structured_data: Json | null
          ocr_structured_fields_count: number | null
          ocr_text: string | null
          storage_bucket: string | null
          structured_error: string | null
          structured_json: Json | null
          structured_status: string
          updated_at: string
          upload_category: string
          upload_order: number
          upload_source: string | null
          user_comment: string | null
          user_id: string
          validator_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          mime_type?: string | null
          ocr_data_quality_score?: number | null
          ocr_error?: string | null
          ocr_status?: string
          ocr_structured_data?: Json | null
          ocr_structured_fields_count?: number | null
          ocr_text?: string | null
          storage_bucket?: string | null
          structured_error?: string | null
          structured_json?: Json | null
          structured_status?: string
          updated_at?: string
          upload_category: string
          upload_order?: number
          upload_source?: string | null
          user_comment?: string | null
          user_id?: string
          validator_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          mime_type?: string | null
          ocr_data_quality_score?: number | null
          ocr_error?: string | null
          ocr_status?: string
          ocr_structured_data?: Json | null
          ocr_structured_fields_count?: number | null
          ocr_text?: string | null
          storage_bucket?: string | null
          structured_error?: string | null
          structured_json?: Json | null
          structured_status?: string
          updated_at?: string
          upload_category?: string
          upload_order?: number
          upload_source?: string | null
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
      feedback_ia_resultados: {
        Row: {
          acertou_humano: boolean | null
          acertou_ia: boolean | null
          analise_ia_id: string | null
          buscas_realizadas: Json | null
          conta_bankroll: boolean
          created_at: string
          decisao_humana_final: string | null
          decisao_ia_sugerida: string | null
          divergencia_ia_humano: boolean | null
          edge_usado: number | null
          esporte: string | null
          fontes_consultadas: Json | null
          id: string
          jogo: string | null
          liga: string | null
          linha: string | null
          lucro_financeiro_unidades: number | null
          lucro_prejuizo: number | null
          lucro_teorico_unidades: number | null
          lucro_unidades: number | null
          mercado: string | null
          modo_ia: string | null
          odd_usada: number | null
          pick: string | null
          probabilidade_final: number | null
          prognostico_id: string | null
          resultado_financeiro: string | null
          resultado_real: string | null
          resultado_teorico: string | null
          stake_humana_final: number | null
          stake_ia_sugerida: number | null
          tags_risco: Json | null
          updated_at: string
        }
        Insert: {
          acertou_humano?: boolean | null
          acertou_ia?: boolean | null
          analise_ia_id?: string | null
          buscas_realizadas?: Json | null
          conta_bankroll?: boolean
          created_at?: string
          decisao_humana_final?: string | null
          decisao_ia_sugerida?: string | null
          divergencia_ia_humano?: boolean | null
          edge_usado?: number | null
          esporte?: string | null
          fontes_consultadas?: Json | null
          id?: string
          jogo?: string | null
          liga?: string | null
          linha?: string | null
          lucro_financeiro_unidades?: number | null
          lucro_prejuizo?: number | null
          lucro_teorico_unidades?: number | null
          lucro_unidades?: number | null
          mercado?: string | null
          modo_ia?: string | null
          odd_usada?: number | null
          pick?: string | null
          probabilidade_final?: number | null
          prognostico_id?: string | null
          resultado_financeiro?: string | null
          resultado_real?: string | null
          resultado_teorico?: string | null
          stake_humana_final?: number | null
          stake_ia_sugerida?: number | null
          tags_risco?: Json | null
          updated_at?: string
        }
        Update: {
          acertou_humano?: boolean | null
          acertou_ia?: boolean | null
          analise_ia_id?: string | null
          buscas_realizadas?: Json | null
          conta_bankroll?: boolean
          created_at?: string
          decisao_humana_final?: string | null
          decisao_ia_sugerida?: string | null
          divergencia_ia_humano?: boolean | null
          edge_usado?: number | null
          esporte?: string | null
          fontes_consultadas?: Json | null
          id?: string
          jogo?: string | null
          liga?: string | null
          linha?: string | null
          lucro_financeiro_unidades?: number | null
          lucro_prejuizo?: number | null
          lucro_teorico_unidades?: number | null
          lucro_unidades?: number | null
          mercado?: string | null
          modo_ia?: string | null
          odd_usada?: number | null
          pick?: string | null
          probabilidade_final?: number | null
          prognostico_id?: string | null
          resultado_financeiro?: string | null
          resultado_real?: string | null
          resultado_teorico?: string | null
          stake_humana_final?: number | null
          stake_ia_sugerida?: number | null
          tags_risco?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_ia_resultados_analise_ia_id_fkey"
            columns: ["analise_ia_id"]
            isOneToOne: false
            referencedRelation: "analises_ia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_ia_resultados_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_ia_resultados_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos_clv"
            referencedColumns: ["prognostico_id"]
          },
        ]
      }
      hl_competition_scopes: {
        Row: {
          aliases: string[]
          canonical_name: string
          capabilities: Json
          catalog_status: string
          competition_level: string
          created_at: string
          gender: string
          id: string
          ingestion_enabled: boolean
          metadata: Json
          priority: number
          provider_competition_id: string | null
          provider_family: string
          provider_id: string
          provider_name: string
          region_code: string | null
          scope_key: string
          selected: boolean
          sport_id: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          canonical_name: string
          capabilities?: Json
          catalog_status?: string
          competition_level?: string
          created_at?: string
          gender?: string
          id?: string
          ingestion_enabled?: boolean
          metadata?: Json
          priority?: number
          provider_competition_id?: string | null
          provider_family: string
          provider_id: string
          provider_name: string
          region_code?: string | null
          scope_key: string
          selected?: boolean
          sport_id: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          canonical_name?: string
          capabilities?: Json
          catalog_status?: string
          competition_level?: string
          created_at?: string
          gender?: string
          id?: string
          ingestion_enabled?: boolean
          metadata?: Json
          priority?: number
          provider_competition_id?: string | null
          provider_family?: string
          provider_id?: string
          provider_name?: string
          region_code?: string | null
          scope_key?: string
          selected?: boolean
          sport_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hl_competition_scopes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "sports_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hl_competition_scopes_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      hl_data_quality_issues: {
        Row: {
          actual_value: Json | null
          created_at: string
          details: Json
          endpoint_key: string
          entity_type: string | null
          expected_value: Json | null
          external_id: string | null
          field_path: string | null
          id: string
          issue_code: string
          raw_object_id: string | null
          resolution_status: string
          resolved_at: string | null
          run_id: string | null
          severity: string
          sport: string
          updated_at: string
        }
        Insert: {
          actual_value?: Json | null
          created_at?: string
          details?: Json
          endpoint_key: string
          entity_type?: string | null
          expected_value?: Json | null
          external_id?: string | null
          field_path?: string | null
          id?: string
          issue_code: string
          raw_object_id?: string | null
          resolution_status?: string
          resolved_at?: string | null
          run_id?: string | null
          severity: string
          sport: string
          updated_at?: string
        }
        Update: {
          actual_value?: Json | null
          created_at?: string
          details?: Json
          endpoint_key?: string
          entity_type?: string | null
          expected_value?: Json | null
          external_id?: string | null
          field_path?: string | null
          id?: string
          issue_code?: string
          raw_object_id?: string | null
          resolution_status?: string
          resolved_at?: string | null
          run_id?: string | null
          severity?: string
          sport?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hl_data_quality_issues_raw_object_id_fkey"
            columns: ["raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hl_data_quality_issues_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "hl_ingestion_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      hl_ingestion_bridge_nonces: {
        Row: {
          expires_at: string
          nonce: string
          request_hash: string
          signed_at: string
          used_at: string
        }
        Insert: {
          expires_at: string
          nonce: string
          request_hash: string
          signed_at: string
          used_at?: string
        }
        Update: {
          expires_at?: string
          nonce?: string
          request_hash?: string
          signed_at?: string
          used_at?: string
        }
        Relationships: []
      }
      hl_ingestion_jobs: {
        Row: {
          attempts: number
          created_at: string
          cursor_data: Json
          dedupe_key: string
          endpoint_key: string
          finished_at: string | null
          id: string
          last_error: string | null
          lock_expires_at: string | null
          locked_at: string | null
          max_attempts: number
          priority: number
          reprocess_raw_object_id: string | null
          request_params: Json
          resource: string
          scheduled_at: string
          shadow_scope: string | null
          sport: string
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          cursor_data?: Json
          dedupe_key: string
          endpoint_key: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          lock_expires_at?: string | null
          locked_at?: string | null
          max_attempts?: number
          priority?: number
          reprocess_raw_object_id?: string | null
          request_params?: Json
          resource: string
          scheduled_at?: string
          shadow_scope?: string | null
          sport: string
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          cursor_data?: Json
          dedupe_key?: string
          endpoint_key?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          lock_expires_at?: string | null
          locked_at?: string | null
          max_attempts?: number
          priority?: number
          reprocess_raw_object_id?: string | null
          request_params?: Json
          resource?: string
          scheduled_at?: string
          shadow_scope?: string | null
          sport?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hl_ingestion_jobs_reprocess_raw_object_id_fkey"
            columns: ["reprocess_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      hl_ingestion_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          http_status: number | null
          id: string
          job_id: string
          rate_limit: number | null
          rate_remaining: number | null
          records_normalized: number
          records_received: number
          records_rejected: number
          started_at: string
          status: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          job_id: string
          rate_limit?: number | null
          rate_remaining?: number | null
          records_normalized?: number
          records_received?: number
          records_rejected?: number
          started_at?: string
          status?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          job_id?: string
          rate_limit?: number | null
          rate_remaining?: number | null
          records_normalized?: number
          records_received?: number
          records_rejected?: number
          started_at?: string
          status?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hl_ingestion_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "hl_ingestion_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      hl_metric_definitions: {
        Row: {
          aggregation: string | null
          canonical_key: string
          created_at: string
          description: string | null
          direction: string
          display_name: string
          first_seen_at: string
          group_name: string
          id: string
          last_seen_at: string
          metadata: Json
          observed_count: number
          provider_id: string
          provider_key: string
          resource: string
          sport_id: string
          status: string
          unit: string | null
          updated_at: string
          value_type: string
        }
        Insert: {
          aggregation?: string | null
          canonical_key: string
          created_at?: string
          description?: string | null
          direction?: string
          display_name: string
          first_seen_at?: string
          group_name?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          observed_count?: number
          provider_id: string
          provider_key: string
          resource: string
          sport_id: string
          status?: string
          unit?: string | null
          updated_at?: string
          value_type: string
        }
        Update: {
          aggregation?: string | null
          canonical_key?: string
          created_at?: string
          description?: string | null
          direction?: string
          display_name?: string
          first_seen_at?: string
          group_name?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          observed_count?: number
          provider_id?: string
          provider_key?: string
          resource?: string
          sport_id?: string
          status?: string
          unit?: string | null
          updated_at?: string
          value_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "hl_metric_definitions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "sports_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hl_metric_definitions_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      hl_rate_limit_usage: {
        Row: {
          created_at: string
          endpoint_key: string
          id: string
          observed_at: string
          provider_id: string
          rate_limit: number | null
          rate_remaining: number | null
          request_date: string
          requests_used: number
          run_id: string | null
        }
        Insert: {
          created_at?: string
          endpoint_key: string
          id?: string
          observed_at?: string
          provider_id: string
          rate_limit?: number | null
          rate_remaining?: number | null
          request_date?: string
          requests_used?: number
          run_id?: string | null
        }
        Update: {
          created_at?: string
          endpoint_key?: string
          id?: string
          observed_at?: string
          provider_id?: string
          rate_limit?: number | null
          rate_remaining?: number | null
          request_date?: string
          requests_used?: number
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hl_rate_limit_usage_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "sports_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hl_rate_limit_usage_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "hl_ingestion_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      hl_raw_objects: {
        Row: {
          byte_size: number
          content_encoding: string
          content_type: string
          created_at: string
          endpoint_key: string
          id: string
          job_id: string | null
          normalized_at: string | null
          provider_id: string
          request_metadata: Json
          response_metadata: Json
          retention_until: string | null
          run_id: string | null
          schema_fingerprint: string | null
          sha256: string
          sport_id: string
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          byte_size: number
          content_encoding?: string
          content_type?: string
          created_at?: string
          endpoint_key: string
          id?: string
          job_id?: string | null
          normalized_at?: string | null
          provider_id: string
          request_metadata?: Json
          response_metadata?: Json
          retention_until?: string | null
          run_id?: string | null
          schema_fingerprint?: string | null
          sha256: string
          sport_id: string
          storage_bucket?: string
          storage_path: string
        }
        Update: {
          byte_size?: number
          content_encoding?: string
          content_type?: string
          created_at?: string
          endpoint_key?: string
          id?: string
          job_id?: string | null
          normalized_at?: string | null
          provider_id?: string
          request_metadata?: Json
          response_metadata?: Json
          retention_until?: string | null
          run_id?: string | null
          schema_fingerprint?: string | null
          sha256?: string
          sport_id?: string
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "hl_raw_objects_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "hl_ingestion_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hl_raw_objects_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "sports_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hl_raw_objects_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "hl_ingestion_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hl_raw_objects_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      hl_shadow_observations: {
        Row: {
          created_at: string
          freshness_p95_seconds: number | null
          id: string
          jobs_dead: number
          jobs_partial: number
          jobs_pending: number
          jobs_retry: number
          jobs_succeeded: number
          jobs_total: number
          latency_p50_ms: number | null
          latency_p95_ms: number | null
          match_coverage_pct: number | null
          matches_expected: number
          matches_seen: number
          matches_with_odds: number
          observed_on: string
          odds_coverage_pct: number | null
          open_critical_issues: number
          open_error_issues: number
          open_warning_issues: number
          requests_used: number
          source_metadata: Json
          sport: string
          updated_at: string
          window_id: string
        }
        Insert: {
          created_at?: string
          freshness_p95_seconds?: number | null
          id?: string
          jobs_dead?: number
          jobs_partial?: number
          jobs_pending?: number
          jobs_retry?: number
          jobs_succeeded?: number
          jobs_total?: number
          latency_p50_ms?: number | null
          latency_p95_ms?: number | null
          match_coverage_pct?: number | null
          matches_expected?: number
          matches_seen?: number
          matches_with_odds?: number
          observed_on: string
          odds_coverage_pct?: number | null
          open_critical_issues?: number
          open_error_issues?: number
          open_warning_issues?: number
          requests_used?: number
          source_metadata?: Json
          sport: string
          updated_at?: string
          window_id: string
        }
        Update: {
          created_at?: string
          freshness_p95_seconds?: number | null
          id?: string
          jobs_dead?: number
          jobs_partial?: number
          jobs_pending?: number
          jobs_retry?: number
          jobs_succeeded?: number
          jobs_total?: number
          latency_p50_ms?: number | null
          latency_p95_ms?: number | null
          match_coverage_pct?: number | null
          matches_expected?: number
          matches_seen?: number
          matches_with_odds?: number
          observed_on?: string
          odds_coverage_pct?: number | null
          open_critical_issues?: number
          open_error_issues?: number
          open_warning_issues?: number
          requests_used?: number
          source_metadata?: Json
          sport?: string
          updated_at?: string
          window_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hl_shadow_observations_window_id_fkey"
            columns: ["window_id"]
            isOneToOne: false
            referencedRelation: "hl_phase7_window_health_v"
            referencedColumns: ["window_id"]
          },
          {
            foreignKeyName: "hl_shadow_observations_window_id_fkey"
            columns: ["window_id"]
            isOneToOne: false
            referencedRelation: "hl_shadow_windows"
            referencedColumns: ["id"]
          },
        ]
      }
      hl_shadow_windows: {
        Row: {
          config: Json
          created_at: string
          daily_request_budget: number
          ended_at: string | null
          freshness_sla_seconds: number
          id: string
          match_coverage_sla: number
          notes: string | null
          odds_coverage_sla: number
          planned_end_at: string
          provider_id: string
          reserve_requests: number
          scope: string
          sports: string[]
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          daily_request_budget?: number
          ended_at?: string | null
          freshness_sla_seconds?: number
          id?: string
          match_coverage_sla?: number
          notes?: string | null
          odds_coverage_sla?: number
          planned_end_at: string
          provider_id: string
          reserve_requests?: number
          scope: string
          sports?: string[]
          started_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          daily_request_budget?: number
          ended_at?: string | null
          freshness_sla_seconds?: number
          id?: string
          match_coverage_sla?: number
          notes?: string | null
          odds_coverage_sla?: number
          planned_end_at?: string
          provider_id?: string
          reserve_requests?: number
          scope?: string
          sports?: string[]
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hl_shadow_windows_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "sports_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      hl_source_reconciliations: {
        Row: {
          competition_key: string
          coverage_pct: number | null
          created_at: string
          details: Json
          expected_matches: number
          extra_in_highlightly: number
          highlightly_matches: number
          id: string
          kickoff_divergences: number
          matched_matches: number
          missing_in_highlightly: number
          observed_on: string
          odds_divergences: number
          score_divergences: number
          source_name: string
          sport: string
          updated_at: string
          window_id: string
        }
        Insert: {
          competition_key?: string
          coverage_pct?: number | null
          created_at?: string
          details?: Json
          expected_matches?: number
          extra_in_highlightly?: number
          highlightly_matches?: number
          id?: string
          kickoff_divergences?: number
          matched_matches?: number
          missing_in_highlightly?: number
          observed_on: string
          odds_divergences?: number
          score_divergences?: number
          source_name: string
          sport: string
          updated_at?: string
          window_id: string
        }
        Update: {
          competition_key?: string
          coverage_pct?: number | null
          created_at?: string
          details?: Json
          expected_matches?: number
          extra_in_highlightly?: number
          highlightly_matches?: number
          id?: string
          kickoff_divergences?: number
          matched_matches?: number
          missing_in_highlightly?: number
          observed_on?: string
          odds_divergences?: number
          score_divergences?: number
          source_name?: string
          sport?: string
          updated_at?: string
          window_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hl_source_reconciliations_window_id_fkey"
            columns: ["window_id"]
            isOneToOne: false
            referencedRelation: "hl_phase7_window_health_v"
            referencedColumns: ["window_id"]
          },
          {
            foreignKeyName: "hl_source_reconciliations_window_id_fkey"
            columns: ["window_id"]
            isOneToOne: false
            referencedRelation: "hl_shadow_windows"
            referencedColumns: ["id"]
          },
        ]
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
      mlb_league_average_snapshots: {
        Row: {
          created_at: string
          home_record_average: string | null
          id: string
          last10_average: string | null
          raw: Json
          road_record_average: string | null
          runs_allowed_per_game_average: number | null
          runs_per_game_average: number | null
          season: number
          snapshot_date: string
          source: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          home_record_average?: string | null
          id?: string
          last10_average?: string | null
          raw?: Json
          road_record_average?: string | null
          runs_allowed_per_game_average?: number | null
          runs_per_game_average?: number | null
          season: number
          snapshot_date: string
          source: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          home_record_average?: string | null
          id?: string
          last10_average?: string | null
          raw?: Json
          road_record_average?: string | null
          runs_allowed_per_game_average?: number | null
          runs_per_game_average?: number | null
          season?: number
          snapshot_date?: string
          source?: string
          source_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      mlb_team_standings_snapshots: {
        Row: {
          created_at: string
          extra_innings_losses: number | null
          extra_innings_wins: number | null
          home_losses: number | null
          home_win_pct: number | null
          home_wins: number | null
          id: string
          interleague_losses: number | null
          interleague_wins: number | null
          last10_losses: number | null
          last10_wins: number | null
          last20_losses: number | null
          last20_wins: number | null
          last30_losses: number | null
          last30_wins: number | null
          losses: number | null
          luck: number | null
          one_run_losses: number | null
          one_run_wins: number | null
          pyth_losses: number | null
          pyth_win_pct: number | null
          pyth_wins: number | null
          rank: number | null
          raw: Json
          road_losses: number | null
          road_win_pct: number | null
          road_wins: number | null
          run_diff_per_game: number | null
          runs_allowed_per_game: number | null
          runs_per_game: number | null
          season: number
          snapshot_date: string
          sos: number | null
          source: string
          source_url: string | null
          srs: number | null
          streak_count: number | null
          streak_result: string | null
          team_key: string
          team_name: string
          updated_at: string
          v_cent_losses: number | null
          v_cent_wins: number | null
          v_east_losses: number | null
          v_east_wins: number | null
          v_west_losses: number | null
          v_west_wins: number | null
          vs_500_minus_losses: number | null
          vs_500_minus_wins: number | null
          vs_500_plus_losses: number | null
          vs_500_plus_wins: number | null
          vs_lhp_losses: number | null
          vs_lhp_wins: number | null
          vs_rhp_losses: number | null
          vs_rhp_wins: number | null
          win_pct: number | null
          wins: number | null
        }
        Insert: {
          created_at?: string
          extra_innings_losses?: number | null
          extra_innings_wins?: number | null
          home_losses?: number | null
          home_win_pct?: number | null
          home_wins?: number | null
          id?: string
          interleague_losses?: number | null
          interleague_wins?: number | null
          last10_losses?: number | null
          last10_wins?: number | null
          last20_losses?: number | null
          last20_wins?: number | null
          last30_losses?: number | null
          last30_wins?: number | null
          losses?: number | null
          luck?: number | null
          one_run_losses?: number | null
          one_run_wins?: number | null
          pyth_losses?: number | null
          pyth_win_pct?: number | null
          pyth_wins?: number | null
          rank?: number | null
          raw?: Json
          road_losses?: number | null
          road_win_pct?: number | null
          road_wins?: number | null
          run_diff_per_game?: number | null
          runs_allowed_per_game?: number | null
          runs_per_game?: number | null
          season: number
          snapshot_date: string
          sos?: number | null
          source: string
          source_url?: string | null
          srs?: number | null
          streak_count?: number | null
          streak_result?: string | null
          team_key: string
          team_name: string
          updated_at?: string
          v_cent_losses?: number | null
          v_cent_wins?: number | null
          v_east_losses?: number | null
          v_east_wins?: number | null
          v_west_losses?: number | null
          v_west_wins?: number | null
          vs_500_minus_losses?: number | null
          vs_500_minus_wins?: number | null
          vs_500_plus_losses?: number | null
          vs_500_plus_wins?: number | null
          vs_lhp_losses?: number | null
          vs_lhp_wins?: number | null
          vs_rhp_losses?: number | null
          vs_rhp_wins?: number | null
          win_pct?: number | null
          wins?: number | null
        }
        Update: {
          created_at?: string
          extra_innings_losses?: number | null
          extra_innings_wins?: number | null
          home_losses?: number | null
          home_win_pct?: number | null
          home_wins?: number | null
          id?: string
          interleague_losses?: number | null
          interleague_wins?: number | null
          last10_losses?: number | null
          last10_wins?: number | null
          last20_losses?: number | null
          last20_wins?: number | null
          last30_losses?: number | null
          last30_wins?: number | null
          losses?: number | null
          luck?: number | null
          one_run_losses?: number | null
          one_run_wins?: number | null
          pyth_losses?: number | null
          pyth_win_pct?: number | null
          pyth_wins?: number | null
          rank?: number | null
          raw?: Json
          road_losses?: number | null
          road_win_pct?: number | null
          road_wins?: number | null
          run_diff_per_game?: number | null
          runs_allowed_per_game?: number | null
          runs_per_game?: number | null
          season?: number
          snapshot_date?: string
          sos?: number | null
          source?: string
          source_url?: string | null
          srs?: number | null
          streak_count?: number | null
          streak_result?: string | null
          team_key?: string
          team_name?: string
          updated_at?: string
          v_cent_losses?: number | null
          v_cent_wins?: number | null
          v_east_losses?: number | null
          v_east_wins?: number | null
          v_west_losses?: number | null
          v_west_wins?: number | null
          vs_500_minus_losses?: number | null
          vs_500_minus_wins?: number | null
          vs_500_plus_losses?: number | null
          vs_500_plus_wins?: number | null
          vs_lhp_losses?: number | null
          vs_lhp_wins?: number | null
          vs_rhp_losses?: number | null
          vs_rhp_wins?: number | null
          win_pct?: number | null
          wins?: number | null
        }
        Relationships: []
      }
      odds_jogos: {
        Row: {
          bookmaker: string | null
          bookmaker_melhor: string | null
          capturado_em: string | null
          casas_count: number | null
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
          margem_mercado_media: number | null
          margem_mercado_mediana: number | null
          mercado: string | null
          odd: number | null
          odd_desvio_padrao: number | null
          odd_maxima: number | null
          odd_media: number | null
          odd_mediana: number | null
          odd_melhor: number | null
          odd_minima: number | null
          odds_disponiveis: number | null
          pick: string | null
          probabilidade_implicita_media: number | null
          probabilidade_implicita_mediana: number | null
          raw_ref: Json | null
          visitante: string | null
        }
        Insert: {
          bookmaker?: string | null
          bookmaker_melhor?: string | null
          capturado_em?: string | null
          casas_count?: number | null
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
          margem_mercado_media?: number | null
          margem_mercado_mediana?: number | null
          mercado?: string | null
          odd?: number | null
          odd_desvio_padrao?: number | null
          odd_maxima?: number | null
          odd_media?: number | null
          odd_mediana?: number | null
          odd_melhor?: number | null
          odd_minima?: number | null
          odds_disponiveis?: number | null
          pick?: string | null
          probabilidade_implicita_media?: number | null
          probabilidade_implicita_mediana?: number | null
          raw_ref?: Json | null
          visitante?: string | null
        }
        Update: {
          bookmaker?: string | null
          bookmaker_melhor?: string | null
          capturado_em?: string | null
          casas_count?: number | null
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
          margem_mercado_media?: number | null
          margem_mercado_mediana?: number | null
          mercado?: string | null
          odd?: number | null
          odd_desvio_padrao?: number | null
          odd_maxima?: number | null
          odd_media?: number | null
          odd_mediana?: number | null
          odd_melhor?: number | null
          odd_minima?: number | null
          odds_disponiveis?: number | null
          pick?: string | null
          probabilidade_implicita_media?: number | null
          probabilidade_implicita_mediana?: number | null
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
      odds_market_snapshots: {
        Row: {
          away_team: string | null
          best_bookmaker: string | null
          best_odd: number | null
          bookmaker_count: number
          captured_at: string
          coleta_id: string
          created_at: string
          eligible_pre_match: boolean
          event_name: string
          event_start_at: string | null
          home_team: string | null
          id: string
          implied_probability_mean: number | null
          implied_probability_median: number | null
          lead_minutes: number | null
          league: string | null
          line: string
          market: string
          market_margin_mean: number | null
          market_margin_median: number | null
          max_odd: number | null
          mean_odd: number | null
          median_odd: number
          min_odd: number | null
          odd_stddev: number | null
          odds_available: number
          period: string
          selection: string
          source: string
          source_event_id: string | null
          source_ref: Json
          sport: string | null
          timing_bucket: string
        }
        Insert: {
          away_team?: string | null
          best_bookmaker?: string | null
          best_odd?: number | null
          bookmaker_count?: number
          captured_at: string
          coleta_id: string
          created_at?: string
          eligible_pre_match: boolean
          event_name: string
          event_start_at?: string | null
          home_team?: string | null
          id?: string
          implied_probability_mean?: number | null
          implied_probability_median?: number | null
          lead_minutes?: number | null
          league?: string | null
          line?: string
          market: string
          market_margin_mean?: number | null
          market_margin_median?: number | null
          max_odd?: number | null
          mean_odd?: number | null
          median_odd: number
          min_odd?: number | null
          odd_stddev?: number | null
          odds_available?: number
          period?: string
          selection: string
          source: string
          source_event_id?: string | null
          source_ref?: Json
          sport?: string | null
          timing_bucket: string
        }
        Update: {
          away_team?: string | null
          best_bookmaker?: string | null
          best_odd?: number | null
          bookmaker_count?: number
          captured_at?: string
          coleta_id?: string
          created_at?: string
          eligible_pre_match?: boolean
          event_name?: string
          event_start_at?: string | null
          home_team?: string | null
          id?: string
          implied_probability_mean?: number | null
          implied_probability_median?: number | null
          lead_minutes?: number | null
          league?: string | null
          line?: string
          market?: string
          market_margin_mean?: number | null
          market_margin_median?: number | null
          max_odd?: number | null
          mean_odd?: number | null
          median_odd?: number
          min_odd?: number | null
          odd_stddev?: number | null
          odds_available?: number
          period?: string
          selection?: string
          source?: string
          source_event_id?: string | null
          source_ref?: Json
          sport?: string | null
          timing_bucket?: string
        }
        Relationships: [
          {
            foreignKeyName: "odds_market_snapshots_coleta_id_fkey"
            columns: ["coleta_id"]
            isOneToOne: false
            referencedRelation: "coletas_odds"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_ranking_items: {
        Row: {
          ai_decision: string | null
          ai_stake_suggested: number | null
          confidence_score: number | null
          created_at: string
          event_key: string
          final_stake: number | null
          group_key: string
          id: string
          matchup_preview_context: string | null
          matchup_preview_status: string
          metadata: Json
          opportunity_score_final: number | null
          opportunity_score_pre: number | null
          prognostico_id: string
          rank_final: number | null
          rank_prelim: number | null
          ranking_status: string
          reasons: Json
          risk_flags: Json
          run_id: string
          score_components: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_decision?: string | null
          ai_stake_suggested?: number | null
          confidence_score?: number | null
          created_at?: string
          event_key: string
          final_stake?: number | null
          group_key: string
          id?: string
          matchup_preview_context?: string | null
          matchup_preview_status?: string
          metadata?: Json
          opportunity_score_final?: number | null
          opportunity_score_pre?: number | null
          prognostico_id: string
          rank_final?: number | null
          rank_prelim?: number | null
          ranking_status?: string
          reasons?: Json
          risk_flags?: Json
          run_id: string
          score_components?: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          ai_decision?: string | null
          ai_stake_suggested?: number | null
          confidence_score?: number | null
          created_at?: string
          event_key?: string
          final_stake?: number | null
          group_key?: string
          id?: string
          matchup_preview_context?: string | null
          matchup_preview_status?: string
          metadata?: Json
          opportunity_score_final?: number | null
          opportunity_score_pre?: number | null
          prognostico_id?: string
          rank_final?: number | null
          rank_prelim?: number | null
          ranking_status?: string
          reasons?: Json
          risk_flags?: Json
          run_id?: string
          score_components?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_ranking_items_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_ranking_items_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos_clv"
            referencedColumns: ["prognostico_id"]
          },
          {
            foreignKeyName: "opportunity_ranking_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "opportunity_ranking_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_ranking_runs: {
        Row: {
          candidate_count: number
          confirmed_ia_count: number
          created_at: string
          event_date_from: string | null
          event_date_to: string | null
          filters_payload: Json
          id: string
          league_scope: string
          market_scope: string
          max_final_picks: number
          metadata: Json
          run_date: string
          scope_key: string
          score_weights: Json
          source_stage: string
          sport_scope: string
          status: string
          top_final_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_count?: number
          confirmed_ia_count?: number
          created_at?: string
          event_date_from?: string | null
          event_date_to?: string | null
          filters_payload?: Json
          id?: string
          league_scope?: string
          market_scope?: string
          max_final_picks?: number
          metadata?: Json
          run_date?: string
          scope_key?: string
          score_weights?: Json
          source_stage?: string
          sport_scope?: string
          status?: string
          top_final_count?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          candidate_count?: number
          confirmed_ia_count?: number
          created_at?: string
          event_date_from?: string | null
          event_date_to?: string | null
          filters_payload?: Json
          id?: string
          league_scope?: string
          market_scope?: string
          max_final_picks?: number
          metadata?: Json
          run_date?: string
          scope_key?: string
          score_weights?: Json
          source_stage?: string
          sport_scope?: string
          status?: string
          top_final_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          nome: string | null
          telegram_chat_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          nome?: string | null
          telegram_chat_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          nome?: string | null
          telegram_chat_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prognostico_odds_historico: {
        Row: {
          edge: number | null
          id: string
          odd: number
          origem: string
          probabilidade_final: number | null
          prognostico_id: string
          registrado_em: string
          tipo: string
        }
        Insert: {
          edge?: number | null
          id?: string
          odd: number
          origem: string
          probabilidade_final?: number | null
          prognostico_id: string
          registrado_em?: string
          tipo: string
        }
        Update: {
          edge?: number | null
          id?: string
          odd?: number
          origem?: string
          probabilidade_final?: number | null
          prognostico_id?: string
          registrado_em?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "prognostico_odds_historico_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prognostico_odds_historico_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos_clv"
            referencedColumns: ["prognostico_id"]
          },
        ]
      }
      prognosticos: {
        Row: {
          arquivo_contexto: string | null
          bookmaker_melhor: string | null
          canal_publicacao: string | null
          contexto_modelo: string | null
          created_at: string
          dados_tecnicos: string | null
          data: string
          data_publicacao: string | null
          edge: number
          edge_ajustado: number | null
          esporte: string
          hora: string | null
          id: string
          is_top_final: boolean
          job_id_coleta: string | null
          jogo: string
          liga: string
          linha: string | null
          lucro_prejuizo: number | null
          mandante: string
          mercado: string
          observacoes: string | null
          odd_ajustada: number | null
          odd_mediana: number | null
          odd_melhor: number | null
          odd_mercado_base: number | null
          odd_ofertada: number
          odd_valor: number
          origem_modelo: string | null
          pick: string
          probabilidade_final: number
          publicado_em: string | null
          publicado_por: string | null
          resultado: string
          stake: number
          status_publicacao: string
          status_validacao: string
          tip_texto: string | null
          top_final_at: string | null
          top_final_rank: number | null
          top_final_run_id: string | null
          updated_at: string
          visitante: string
        }
        Insert: {
          arquivo_contexto?: string | null
          bookmaker_melhor?: string | null
          canal_publicacao?: string | null
          contexto_modelo?: string | null
          created_at?: string
          dados_tecnicos?: string | null
          data?: string
          data_publicacao?: string | null
          edge: number
          edge_ajustado?: number | null
          esporte: string
          hora?: string | null
          id?: string
          is_top_final?: boolean
          job_id_coleta?: string | null
          jogo: string
          liga: string
          linha?: string | null
          lucro_prejuizo?: number | null
          mandante: string
          mercado: string
          observacoes?: string | null
          odd_ajustada?: number | null
          odd_mediana?: number | null
          odd_melhor?: number | null
          odd_mercado_base?: number | null
          odd_ofertada: number
          odd_valor: number
          origem_modelo?: string | null
          pick: string
          probabilidade_final: number
          publicado_em?: string | null
          publicado_por?: string | null
          resultado?: string
          stake?: number
          status_publicacao?: string
          status_validacao?: string
          tip_texto?: string | null
          top_final_at?: string | null
          top_final_rank?: number | null
          top_final_run_id?: string | null
          updated_at?: string
          visitante: string
        }
        Update: {
          arquivo_contexto?: string | null
          bookmaker_melhor?: string | null
          canal_publicacao?: string | null
          contexto_modelo?: string | null
          created_at?: string
          dados_tecnicos?: string | null
          data?: string
          data_publicacao?: string | null
          edge?: number
          edge_ajustado?: number | null
          esporte?: string
          hora?: string | null
          id?: string
          is_top_final?: boolean
          job_id_coleta?: string | null
          jogo?: string
          liga?: string
          linha?: string | null
          lucro_prejuizo?: number | null
          mandante?: string
          mercado?: string
          observacoes?: string | null
          odd_ajustada?: number | null
          odd_mediana?: number | null
          odd_melhor?: number | null
          odd_mercado_base?: number | null
          odd_ofertada?: number
          odd_valor?: number
          origem_modelo?: string | null
          pick?: string
          probabilidade_final?: number
          publicado_em?: string | null
          publicado_por?: string | null
          resultado?: string
          stake?: number
          status_publicacao?: string
          status_validacao?: string
          tip_texto?: string | null
          top_final_at?: string | null
          top_final_rank?: number | null
          top_final_run_id?: string | null
          updated_at?: string
          visitante?: string
        }
        Relationships: [
          {
            foreignKeyName: "prognosticos_top_final_run_id_fkey"
            columns: ["top_final_run_id"]
            isOneToOne: false
            referencedRelation: "opportunity_ranking_runs"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "resultados_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos_clv"
            referencedColumns: ["prognostico_id"]
          },
        ]
      }
      sports: {
        Row: {
          code: string
          created_at: string
          enabled: boolean
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          enabled?: boolean
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          enabled?: boolean
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sports_bookmakers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_preferred: boolean
          logo_url: string | null
          metadata: Json
          name: string
          normalized_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_preferred?: boolean
          logo_url?: string | null
          metadata?: Json
          name: string
          normalized_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_preferred?: boolean
          logo_url?: string | null
          metadata?: Json
          name?: string
          normalized_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sports_competitions: {
        Row: {
          competition_type: string | null
          country_id: string | null
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          metadata: Json
          name: string
          short_name: string | null
          sport_id: string
          updated_at: string
        }
        Insert: {
          competition_type?: string | null
          country_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          metadata?: Json
          name: string
          short_name?: string | null
          sport_id: string
          updated_at?: string
        }
        Update: {
          competition_type?: string | null
          country_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          metadata?: Json
          name?: string
          short_name?: string | null
          sport_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_competitions_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "sports_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_competitions_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["country_id"]
          },
          {
            foreignKeyName: "sports_competitions_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_countries: {
        Row: {
          code: string | null
          created_at: string
          flag_url: string | null
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          flag_url?: string | null
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          flag_url?: string | null
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sports_highlights: {
        Row: {
          category: string | null
          channel_name: string | null
          content_url: string
          created_at: string
          description: string | null
          duration_seconds: number | null
          embed_url: string | null
          external_id: string
          geo_restrictions: Json
          highlight_type: string | null
          id: string
          match_id: string | null
          metadata: Json
          preview_url: string | null
          provider_id: string
          published_at: string | null
          source_name: string | null
          source_raw_object_id: string | null
          sport_id: string
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          channel_name?: string | null
          content_url: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          embed_url?: string | null
          external_id: string
          geo_restrictions?: Json
          highlight_type?: string | null
          id?: string
          match_id?: string | null
          metadata?: Json
          preview_url?: string | null
          provider_id: string
          published_at?: string | null
          source_name?: string | null
          source_raw_object_id?: string | null
          sport_id: string
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          channel_name?: string | null
          content_url?: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          embed_url?: string | null
          external_id?: string
          geo_restrictions?: Json
          highlight_type?: string | null
          id?: string
          match_id?: string | null
          metadata?: Json
          preview_url?: string | null
          provider_id?: string
          published_at?: string | null
          source_name?: string | null
          source_raw_object_id?: string | null
          sport_id?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_highlights_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_highlights_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_highlights_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_highlights_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_highlights_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "sports_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_highlights_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_highlights_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_lineup_players: {
        Row: {
          created_at: string
          formation_order: number | null
          formation_row: number | null
          id: string
          lineup_id: string
          metadata: Json
          player_id: string
          position: string | null
          role: string
          shirt_number: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          formation_order?: number | null
          formation_row?: number | null
          id?: string
          lineup_id: string
          metadata?: Json
          player_id: string
          position?: string | null
          role?: string
          shirt_number?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          formation_order?: number | null
          formation_row?: number | null
          id?: string
          lineup_id?: string
          metadata?: Json
          player_id?: string
          position?: string | null
          role?: string
          shirt_number?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_lineup_players_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: false
            referencedRelation: "sports_lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_lineup_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_lineup_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_lineup_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_players"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_lineups: {
        Row: {
          coach_name: string | null
          created_at: string
          formation: string | null
          id: string
          is_confirmed: boolean
          match_id: string
          metadata: Json
          published_at: string | null
          source_raw_object_id: string | null
          team_id: string
          updated_at: string
          version_key: string
        }
        Insert: {
          coach_name?: string | null
          created_at?: string
          formation?: string | null
          id?: string
          is_confirmed?: boolean
          match_id: string
          metadata?: Json
          published_at?: string | null
          source_raw_object_id?: string | null
          team_id: string
          updated_at?: string
          version_key: string
        }
        Update: {
          coach_name?: string | null
          created_at?: string
          formation?: string | null
          id?: string
          is_confirmed?: boolean
          match_id?: string
          metadata?: Json
          published_at?: string | null
          source_raw_object_id?: string | null
          team_id?: string
          updated_at?: string
          version_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_lineups_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_lineups_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_lineups_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_lineups_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_lineups_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_market_definitions: {
        Row: {
          canonical_family: string
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          metadata: Json
          odds_type: string
          provider_id: string
          provider_market_key: string
          settlement_rule: string | null
          sport_id: string
          updated_at: string
        }
        Insert: {
          canonical_family: string
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          metadata?: Json
          odds_type?: string
          provider_id: string
          provider_market_key: string
          settlement_rule?: string | null
          sport_id: string
          updated_at?: string
        }
        Update: {
          canonical_family?: string
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          odds_type?: string
          provider_id?: string
          provider_market_key?: string
          settlement_rule?: string | null
          sport_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_market_definitions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "sports_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_market_definitions_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_match_events: {
        Row: {
          clock_display: string | null
          collected_at: string
          created_at: string
          elapsed_seconds: number | null
          event_type: string
          id: string
          match_id: string
          metadata: Json
          occurred_at: string | null
          period_key: string
          player_id: string | null
          related_player_id: string | null
          score_data: Json
          sequence_key: string
          source_raw_object_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          clock_display?: string | null
          collected_at?: string
          created_at?: string
          elapsed_seconds?: number | null
          event_type: string
          id?: string
          match_id: string
          metadata?: Json
          occurred_at?: string | null
          period_key?: string
          player_id?: string | null
          related_player_id?: string | null
          score_data?: Json
          sequence_key: string
          source_raw_object_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          clock_display?: string | null
          collected_at?: string
          created_at?: string
          elapsed_seconds?: number | null
          event_type?: string
          id?: string
          match_id?: string
          metadata?: Json
          occurred_at?: string | null
          period_key?: string
          player_id?: string | null
          related_player_id?: string | null
          score_data?: Json
          sequence_key?: string
          source_raw_object_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_match_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_match_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_match_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_match_events_related_player_id_fkey"
            columns: ["related_player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_match_events_related_player_id_fkey"
            columns: ["related_player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_match_events_related_player_id_fkey"
            columns: ["related_player_id"]
            isOneToOne: false
            referencedRelation: "sports_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_match_events_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_match_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_match_participants: {
        Row: {
          created_at: string
          id: string
          match_id: string
          metadata: Json
          role: string
          score_data: Json
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          metadata?: Json
          role: string
          score_data?: Json
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          metadata?: Json
          role?: string
          score_data?: Json
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_match_participants_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_participants_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_participants_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_participants_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_match_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_match_period_scores: {
        Row: {
          created_at: string
          id: string
          match_id: string
          metadata: Json
          period_key: string
          period_order: number
          score: number
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          metadata?: Json
          period_key: string
          period_order: number
          score: number
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          metadata?: Json
          period_key?: string
          period_order?: number
          score?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_match_period_scores_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_period_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_match_team_stats: {
        Row: {
          boolean_value: boolean | null
          collected_at: string
          created_at: string
          id: string
          json_value: Json | null
          match_id: string
          metric_definition_id: string
          numeric_value: number | null
          period_key: string
          source_raw_object_id: string | null
          split_key: string
          team_id: string
          text_value: string | null
          updated_at: string
        }
        Insert: {
          boolean_value?: boolean | null
          collected_at?: string
          created_at?: string
          id?: string
          json_value?: Json | null
          match_id: string
          metric_definition_id: string
          numeric_value?: number | null
          period_key?: string
          source_raw_object_id?: string | null
          split_key?: string
          team_id: string
          text_value?: string | null
          updated_at?: string
        }
        Update: {
          boolean_value?: boolean | null
          collected_at?: string
          created_at?: string
          id?: string
          json_value?: Json | null
          match_id?: string
          metric_definition_id?: string
          numeric_value?: number | null
          period_key?: string
          source_raw_object_id?: string | null
          split_key?: string
          team_id?: string
          text_value?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_match_team_stats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_metric_definition_id_fkey"
            columns: ["metric_definition_id"]
            isOneToOne: false
            referencedRelation: "hl_metric_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_match_team_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_matches: {
        Row: {
          competition_id: string | null
          created_at: string
          ended_at: string | null
          id: string
          kickoff_at: string | null
          provider_status: string | null
          round_name: string | null
          score_data: Json
          season_id: string | null
          sport_id: string
          state_data: Json
          status: string
          updated_at: string
          venue_data: Json
          venue_name: string | null
        }
        Insert: {
          competition_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          kickoff_at?: string | null
          provider_status?: string | null
          round_name?: string | null
          score_data?: Json
          season_id?: string | null
          sport_id: string
          state_data?: Json
          status?: string
          updated_at?: string
          venue_data?: Json
          venue_name?: string | null
        }
        Update: {
          competition_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          kickoff_at?: string | null
          provider_status?: string | null
          round_name?: string | null
          score_data?: Json
          season_id?: string | null
          sport_id?: string
          state_data?: Json
          status?: string
          updated_at?: string
          venue_data?: Json
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sports_matches_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_matches_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_matches_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_matches_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_matches_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_odds_consensus: {
        Row: {
          best_odds: number
          bookmaker_count: number
          bookmaker_ids: string[]
          created_at: string
          id: string
          iqr: number
          is_live: boolean
          line_key: string
          line_value: number | null
          market_definition_id: string
          match_id: string
          median_odds: number
          minimum_odds: number
          selection_key: string
          selection_name: string
          snapshot_at: string
        }
        Insert: {
          best_odds: number
          bookmaker_count: number
          bookmaker_ids?: string[]
          created_at?: string
          id?: string
          iqr?: number
          is_live?: boolean
          line_key?: string
          line_value?: number | null
          market_definition_id: string
          match_id: string
          median_odds: number
          minimum_odds: number
          selection_key: string
          selection_name: string
          snapshot_at: string
        }
        Update: {
          best_odds?: number
          bookmaker_count?: number
          bookmaker_ids?: string[]
          created_at?: string
          id?: string
          iqr?: number
          is_live?: boolean
          line_key?: string
          line_value?: number | null
          market_definition_id?: string
          match_id?: string
          median_odds?: number
          minimum_odds?: number
          selection_key?: string
          selection_name?: string
          snapshot_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_odds_consensus_market_definition_id_fkey"
            columns: ["market_definition_id"]
            isOneToOne: false
            referencedRelation: "sports_market_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_odds_consensus_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_odds_consensus_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_odds_consensus_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_odds_consensus_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_odds_current: {
        Row: {
          bookmaker_id: string
          created_at: string
          decimal_odds: number
          first_seen_at: string
          id: string
          is_live: boolean
          last_seen_at: string
          line_key: string
          line_value: number | null
          market_definition_id: string
          match_id: string
          provider_updated_at: string | null
          quote_status: string
          selection_key: string
          selection_name: string
          source_raw_object_id: string | null
          updated_at: string
        }
        Insert: {
          bookmaker_id: string
          created_at?: string
          decimal_odds: number
          first_seen_at?: string
          id?: string
          is_live?: boolean
          last_seen_at?: string
          line_key?: string
          line_value?: number | null
          market_definition_id: string
          match_id: string
          provider_updated_at?: string | null
          quote_status?: string
          selection_key: string
          selection_name: string
          source_raw_object_id?: string | null
          updated_at?: string
        }
        Update: {
          bookmaker_id?: string
          created_at?: string
          decimal_odds?: number
          first_seen_at?: string
          id?: string
          is_live?: boolean
          last_seen_at?: string
          line_key?: string
          line_value?: number | null
          market_definition_id?: string
          match_id?: string
          provider_updated_at?: string | null
          quote_status?: string
          selection_key?: string
          selection_name?: string
          source_raw_object_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_odds_current_bookmaker_id_fkey"
            columns: ["bookmaker_id"]
            isOneToOne: false
            referencedRelation: "sports_bookmakers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_odds_current_market_definition_id_fkey"
            columns: ["market_definition_id"]
            isOneToOne: false
            referencedRelation: "sports_market_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_odds_current_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_odds_current_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_odds_current_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_odds_current_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_odds_current_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_odds_history: {
        Row: {
          bookmaker_id: string
          captured_at: string
          change_kind: string
          created_at: string
          current_quote_id: string
          decimal_odds: number
          id: string
          is_live: boolean
          line_key: string
          line_value: number | null
          market_definition_id: string
          match_id: string
          previous_decimal_odds: number | null
          previous_quote_status: string | null
          provider_updated_at: string | null
          quote_fingerprint: string
          quote_status: string
          selection_key: string
          selection_name: string
          source_raw_object_id: string | null
        }
        Insert: {
          bookmaker_id: string
          captured_at?: string
          change_kind: string
          created_at?: string
          current_quote_id: string
          decimal_odds: number
          id?: string
          is_live?: boolean
          line_key?: string
          line_value?: number | null
          market_definition_id: string
          match_id: string
          previous_decimal_odds?: number | null
          previous_quote_status?: string | null
          provider_updated_at?: string | null
          quote_fingerprint: string
          quote_status: string
          selection_key: string
          selection_name: string
          source_raw_object_id?: string | null
        }
        Update: {
          bookmaker_id?: string
          captured_at?: string
          change_kind?: string
          created_at?: string
          current_quote_id?: string
          decimal_odds?: number
          id?: string
          is_live?: boolean
          line_key?: string
          line_value?: number | null
          market_definition_id?: string
          match_id?: string
          previous_decimal_odds?: number | null
          previous_quote_status?: string | null
          provider_updated_at?: string | null
          quote_fingerprint?: string
          quote_status?: string
          selection_key?: string
          selection_name?: string
          source_raw_object_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sports_odds_history_bookmaker_id_fkey"
            columns: ["bookmaker_id"]
            isOneToOne: false
            referencedRelation: "sports_bookmakers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_odds_history_current_quote_id_fkey"
            columns: ["current_quote_id"]
            isOneToOne: false
            referencedRelation: "sports_odds_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_odds_history_market_definition_id_fkey"
            columns: ["market_definition_id"]
            isOneToOne: false
            referencedRelation: "sports_market_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_odds_history_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_odds_history_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_odds_history_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_odds_history_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_odds_history_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_player_box_scores: {
        Row: {
          boolean_value: boolean | null
          collected_at: string
          created_at: string
          id: string
          json_value: Json | null
          match_id: string
          metric_definition_id: string
          numeric_value: number | null
          period_key: string
          player_id: string
          source_raw_object_id: string | null
          team_id: string
          text_value: string | null
          updated_at: string
        }
        Insert: {
          boolean_value?: boolean | null
          collected_at?: string
          created_at?: string
          id?: string
          json_value?: Json | null
          match_id: string
          metric_definition_id: string
          numeric_value?: number | null
          period_key?: string
          player_id: string
          source_raw_object_id?: string | null
          team_id: string
          text_value?: string | null
          updated_at?: string
        }
        Update: {
          boolean_value?: boolean | null
          collected_at?: string
          created_at?: string
          id?: string
          json_value?: Json | null
          match_id?: string
          metric_definition_id?: string
          numeric_value?: number | null
          period_key?: string
          player_id?: string
          source_raw_object_id?: string | null
          team_id?: string
          text_value?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_player_box_scores_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "sports_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_metric_definition_id_fkey"
            columns: ["metric_definition_id"]
            isOneToOne: false
            referencedRelation: "hl_metric_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_player_box_scores_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_player_stats: {
        Row: {
          boolean_value: boolean | null
          collected_at: string
          competition_id: string | null
          created_at: string
          id: string
          json_value: Json | null
          metric_definition_id: string
          numeric_value: number | null
          period_key: string
          player_id: string
          scope_key: string
          season_id: string | null
          source_raw_object_id: string | null
          split_key: string
          team_id: string | null
          text_value: string | null
          updated_at: string
        }
        Insert: {
          boolean_value?: boolean | null
          collected_at?: string
          competition_id?: string | null
          created_at?: string
          id?: string
          json_value?: Json | null
          metric_definition_id: string
          numeric_value?: number | null
          period_key?: string
          player_id: string
          scope_key: string
          season_id?: string | null
          source_raw_object_id?: string | null
          split_key?: string
          team_id?: string | null
          text_value?: string | null
          updated_at?: string
        }
        Update: {
          boolean_value?: boolean | null
          collected_at?: string
          competition_id?: string | null
          created_at?: string
          id?: string
          json_value?: Json | null
          metric_definition_id?: string
          numeric_value?: number | null
          period_key?: string
          player_id?: string
          scope_key?: string
          season_id?: string | null
          source_raw_object_id?: string | null
          split_key?: string
          team_id?: string | null
          text_value?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_player_stats_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_player_stats_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_player_stats_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_player_stats_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_player_stats_metric_definition_id_fkey"
            columns: ["metric_definition_id"]
            isOneToOne: false
            referencedRelation: "hl_metric_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_starting_pitcher_id"]
          },
          {
            foreignKeyName: "sports_player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "sports_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_player_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_player_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_player_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_player_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_player_stats_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_player_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_player_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_player_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_player_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_player_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_player_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_player_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_players: {
        Row: {
          birth_date: string | null
          created_at: string
          current_team_id: string | null
          display_name: string | null
          first_name: string | null
          id: string
          image_url: string | null
          last_name: string | null
          metadata: Json
          name: string
          nationality: string | null
          position: string | null
          sport_id: string
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          current_team_id?: string | null
          display_name?: string | null
          first_name?: string | null
          id?: string
          image_url?: string | null
          last_name?: string | null
          metadata?: Json
          name: string
          nationality?: string | null
          position?: string | null
          sport_id: string
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          current_team_id?: string | null
          display_name?: string | null
          first_name?: string | null
          id?: string
          image_url?: string | null
          last_name?: string | null
          metadata?: Json
          name?: string
          nationality?: string | null
          position?: string | null
          sport_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_players_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_players_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_players_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_players_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_players_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_players_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_players_current_team_id_fkey"
            columns: ["current_team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_players_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_provider_entities: {
        Row: {
          canonical_id: string
          created_at: string
          entity_type: string
          external_id: string
          first_seen_at: string
          id: string
          last_seen_at: string
          provider_id: string
          provider_payload: Json
          sport_id: string
          updated_at: string
        }
        Insert: {
          canonical_id: string
          created_at?: string
          entity_type: string
          external_id: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          provider_id: string
          provider_payload?: Json
          sport_id: string
          updated_at?: string
        }
        Update: {
          canonical_id?: string
          created_at?: string
          entity_type?: string
          external_id?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          provider_id?: string
          provider_payload?: Json
          sport_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_provider_entities_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "sports_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_provider_entities_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_providers: {
        Row: {
          base_url: string | null
          code: string
          contract_version: string | null
          created_at: string
          enabled: boolean
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          code: string
          contract_version?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          code?: string
          contract_version?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sports_seasons: {
        Row: {
          competition_id: string
          created_at: string
          end_date: string | null
          id: string
          is_current: boolean
          label: string
          metadata: Json
          start_date: string | null
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_current?: boolean
          label: string
          metadata?: Json
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_current?: boolean
          label?: string
          metadata?: Json
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_seasons_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_seasons_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_seasons_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_seasons_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["competition_id"]
          },
        ]
      }
      sports_standings_snapshots: {
        Row: {
          competition_id: string
          conceded: number | null
          created_at: string
          draws: number | null
          form: string | null
          goal_difference: number | null
          group_key: string
          id: string
          losses: number | null
          metadata: Json
          played: number | null
          points: number
          quality_status: string
          rank: number
          scored: number | null
          season_id: string
          snapshot_at: string
          source_raw_object_id: string | null
          split_data: Json
          team_id: string
          wins: number | null
        }
        Insert: {
          competition_id: string
          conceded?: number | null
          created_at?: string
          draws?: number | null
          form?: string | null
          goal_difference?: number | null
          group_key?: string
          id?: string
          losses?: number | null
          metadata?: Json
          played?: number | null
          points?: number
          quality_status?: string
          rank: number
          scored?: number | null
          season_id: string
          snapshot_at: string
          source_raw_object_id?: string | null
          split_data?: Json
          team_id: string
          wins?: number | null
        }
        Update: {
          competition_id?: string
          conceded?: number | null
          created_at?: string
          draws?: number | null
          form?: string | null
          goal_difference?: number | null
          group_key?: string
          id?: string
          losses?: number | null
          metadata?: Json
          played?: number | null
          points?: number
          quality_status?: string
          rank?: number
          scored?: number | null
          season_id?: string
          snapshot_at?: string
          source_raw_object_id?: string | null
          split_data?: Json
          team_id?: string
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sports_standings_snapshots_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_standings_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_team_season_stats: {
        Row: {
          boolean_value: boolean | null
          collected_at: string
          competition_id: string | null
          created_at: string
          id: string
          json_value: Json | null
          metric_definition_id: string
          numeric_value: number | null
          period_key: string
          scope_key: string
          season_id: string | null
          source_raw_object_id: string | null
          split_key: string
          team_id: string
          text_value: string | null
          updated_at: string
          window_from: string | null
          window_to: string | null
        }
        Insert: {
          boolean_value?: boolean | null
          collected_at?: string
          competition_id?: string | null
          created_at?: string
          id?: string
          json_value?: Json | null
          metric_definition_id: string
          numeric_value?: number | null
          period_key?: string
          scope_key: string
          season_id?: string | null
          source_raw_object_id?: string | null
          split_key?: string
          team_id: string
          text_value?: string | null
          updated_at?: string
          window_from?: string | null
          window_to?: string | null
        }
        Update: {
          boolean_value?: boolean | null
          collected_at?: string
          competition_id?: string | null
          created_at?: string
          id?: string
          json_value?: Json | null
          metric_definition_id?: string
          numeric_value?: number | null
          period_key?: string
          scope_key?: string
          season_id?: string | null
          source_raw_object_id?: string | null
          split_key?: string
          team_id?: string
          text_value?: string | null
          updated_at?: string
          window_from?: string | null
          window_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sports_team_season_stats_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["competition_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_metric_definition_id_fkey"
            columns: ["metric_definition_id"]
            isOneToOne: false
            referencedRelation: "hl_metric_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "sports_seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_source_raw_object_id_fkey"
            columns: ["source_raw_object_id"]
            isOneToOne: false
            referencedRelation: "hl_raw_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_baseball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_basketball_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["away_team_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["home_team_id"]
          },
          {
            foreignKeyName: "sports_team_season_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "sports_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sports_teams: {
        Row: {
          abbreviation: string | null
          country_id: string | null
          created_at: string
          display_name: string | null
          id: string
          logo_url: string | null
          metadata: Json
          name: string
          sport_id: string
          team_type: string | null
          updated_at: string
        }
        Insert: {
          abbreviation?: string | null
          country_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          logo_url?: string | null
          metadata?: Json
          name: string
          sport_id: string
          team_type?: string | null
          updated_at?: string
        }
        Update: {
          abbreviation?: string | null
          country_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          logo_url?: string | null
          metadata?: Json
          name?: string
          sport_id?: string
          team_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_teams_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "sports_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sports_teams_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "sports_football_match_summary_v"
            referencedColumns: ["country_id"]
          },
          {
            foreignKeyName: "sports_teams_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
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
      validacao_critica_telegram_alerts: {
        Row: {
          alert_enabled: boolean
          alert_minutes_before: number
          alert_payload: Json | null
          alert_target_at: string | null
          attempt_count: number
          away_team: string | null
          created_at: string
          critical_validation_id: string | null
          dedupe_hash: string | null
          event_date: string | null
          event_start_at: string | null
          event_time: string | null
          home_team: string | null
          id: string
          last_attempt_at: string | null
          league: string | null
          line: string | null
          market: string | null
          matchup: string | null
          metadata: Json | null
          next_retry_at: string | null
          odd: number | null
          pick: string | null
          source_payload: Json | null
          source_record_id: string | null
          source_table: string | null
          sport: string | null
          status: string
          telegram_chat_id: string | null
          telegram_error: string | null
          telegram_message_id: string | null
          telegram_sent_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_enabled?: boolean
          alert_minutes_before?: number
          alert_payload?: Json | null
          alert_target_at?: string | null
          attempt_count?: number
          away_team?: string | null
          created_at?: string
          critical_validation_id?: string | null
          dedupe_hash?: string | null
          event_date?: string | null
          event_start_at?: string | null
          event_time?: string | null
          home_team?: string | null
          id?: string
          last_attempt_at?: string | null
          league?: string | null
          line?: string | null
          market?: string | null
          matchup?: string | null
          metadata?: Json | null
          next_retry_at?: string | null
          odd?: number | null
          pick?: string | null
          source_payload?: Json | null
          source_record_id?: string | null
          source_table?: string | null
          sport?: string | null
          status?: string
          telegram_chat_id?: string | null
          telegram_error?: string | null
          telegram_message_id?: string | null
          telegram_sent_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_enabled?: boolean
          alert_minutes_before?: number
          alert_payload?: Json | null
          alert_target_at?: string | null
          attempt_count?: number
          away_team?: string | null
          created_at?: string
          critical_validation_id?: string | null
          dedupe_hash?: string | null
          event_date?: string | null
          event_start_at?: string | null
          event_time?: string | null
          home_team?: string | null
          id?: string
          last_attempt_at?: string | null
          league?: string | null
          line?: string | null
          market?: string | null
          matchup?: string | null
          metadata?: Json | null
          next_retry_at?: string | null
          odd?: number | null
          pick?: string | null
          source_payload?: Json | null
          source_record_id?: string | null
          source_table?: string | null
          sport?: string | null
          status?: string
          telegram_chat_id?: string | null
          telegram_error?: string | null
          telegram_message_id?: string | null
          telegram_sent_at?: string | null
          updated_at?: string
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
          {
            foreignKeyName: "validacoes_prognostico_id_fkey"
            columns: ["prognostico_id"]
            isOneToOne: false
            referencedRelation: "prognosticos_clv"
            referencedColumns: ["prognostico_id"]
          },
        ]
      }
    }
    Views: {
      hl_phase7_window_health_v: {
        Row: {
          daily_request_budget: number | null
          ended_at: string | null
          freshness_sla_seconds: number | null
          gate_status: string | null
          match_coverage_sla: number | null
          maximum_freshness_p95_seconds: number | null
          maximum_latency_p95_ms: number | null
          minimum_match_coverage_pct: number | null
          minimum_odds_coverage_pct: number | null
          observed_days: number | null
          odds_coverage_sla: number | null
          open_critical_issues: number | null
          planned_end_at: string | null
          requests_used: number | null
          reserve_requests: number | null
          scope: string | null
          sports: string[] | null
          started_at: string | null
          status: string | null
          unrecovered_jobs: number | null
          window_id: string | null
        }
        Relationships: []
      }
      hl_selected_competition_scopes_v: {
        Row: {
          aliases: string[] | null
          canonical_name: string | null
          capabilities: Json | null
          catalog_status: string | null
          competition_level: string | null
          gender: string | null
          id: string | null
          ingestion_enabled: boolean | null
          metadata: Json | null
          priority: number | null
          provider_competition_id: string | null
          provider_family: string | null
          provider_name: string | null
          region_code: string | null
          scope_key: string | null
          sport: string | null
          sport_name: string | null
        }
        Relationships: []
      }
      odds_backtest_snapshots: {
        Row: {
          away_team: string | null
          best_bookmaker: string | null
          best_odd: number | null
          bookmaker_count: number | null
          captured_at: string | null
          coleta_id: string | null
          created_at: string | null
          eligible_pre_match: boolean | null
          event_name: string | null
          event_start_at: string | null
          home_team: string | null
          id: string | null
          implied_probability_mean: number | null
          implied_probability_median: number | null
          lead_minutes: number | null
          league: string | null
          line: string | null
          market: string | null
          market_margin_mean: number | null
          market_margin_median: number | null
          max_odd: number | null
          mean_odd: number | null
          median_odd: number | null
          min_odd: number | null
          odd_stddev: number | null
          odds_available: number | null
          period: string | null
          selection: string | null
          source: string | null
          source_event_id: string | null
          source_ref: Json | null
          sport: string | null
          timing_bucket: string | null
        }
        Insert: {
          away_team?: string | null
          best_bookmaker?: string | null
          best_odd?: number | null
          bookmaker_count?: number | null
          captured_at?: string | null
          coleta_id?: string | null
          created_at?: string | null
          eligible_pre_match?: boolean | null
          event_name?: string | null
          event_start_at?: string | null
          home_team?: string | null
          id?: string | null
          implied_probability_mean?: number | null
          implied_probability_median?: number | null
          lead_minutes?: number | null
          league?: string | null
          line?: string | null
          market?: string | null
          market_margin_mean?: number | null
          market_margin_median?: number | null
          max_odd?: number | null
          mean_odd?: number | null
          median_odd?: number | null
          min_odd?: number | null
          odd_stddev?: number | null
          odds_available?: number | null
          period?: string | null
          selection?: string | null
          source?: string | null
          source_event_id?: string | null
          source_ref?: Json | null
          sport?: string | null
          timing_bucket?: string | null
        }
        Update: {
          away_team?: string | null
          best_bookmaker?: string | null
          best_odd?: number | null
          bookmaker_count?: number | null
          captured_at?: string | null
          coleta_id?: string | null
          created_at?: string | null
          eligible_pre_match?: boolean | null
          event_name?: string | null
          event_start_at?: string | null
          home_team?: string | null
          id?: string | null
          implied_probability_mean?: number | null
          implied_probability_median?: number | null
          lead_minutes?: number | null
          league?: string | null
          line?: string | null
          market?: string | null
          market_margin_mean?: number | null
          market_margin_median?: number | null
          max_odd?: number | null
          mean_odd?: number | null
          median_odd?: number | null
          min_odd?: number | null
          odd_stddev?: number | null
          odds_available?: number | null
          period?: string | null
          selection?: string | null
          source?: string | null
          source_event_id?: string | null
          source_ref?: Json | null
          sport?: string | null
          timing_bucket?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "odds_market_snapshots_coleta_id_fkey"
            columns: ["coleta_id"]
            isOneToOne: false
            referencedRelation: "coletas_odds"
            referencedColumns: ["id"]
          },
        ]
      }
      prognosticos_clv: {
        Row: {
          clv: number | null
          data: string | null
          fechamento_registrado_em: string | null
          jogo: string | null
          mercado: string | null
          odd_fechamento: number | null
          odd_validacao: number | null
          prognostico_id: string | null
          validada_em: string | null
        }
        Relationships: []
      }
      sports_baseball_match_summary_v: {
        Row: {
          away_score_data: Json | null
          away_starting_pitcher_id: string | null
          away_starting_pitcher_name: string | null
          away_starting_pitcher_status: string | null
          away_team_id: string | null
          away_team_logo_url: string | null
          away_team_name: string | null
          competition_id: string | null
          competition_name: string | null
          competition_short_name: string | null
          home_score_data: Json | null
          home_starting_pitcher_id: string | null
          home_starting_pitcher_name: string | null
          home_starting_pitcher_status: string | null
          home_team_id: string | null
          home_team_logo_url: string | null
          home_team_name: string | null
          kickoff_at: string | null
          match_id: string | null
          provider_status: string | null
          round_name: string | null
          score_data: Json | null
          season_id: string | null
          season_label: string | null
          state_data: Json | null
          status: string | null
          updated_at: string | null
          venue_name: string | null
        }
        Relationships: []
      }
      sports_basketball_match_summary_v: {
        Row: {
          away_score_data: Json | null
          away_team_id: string | null
          away_team_logo_url: string | null
          away_team_name: string | null
          competition_id: string | null
          competition_name: string | null
          competition_short_name: string | null
          home_score_data: Json | null
          home_team_id: string | null
          home_team_logo_url: string | null
          home_team_name: string | null
          kickoff_at: string | null
          match_id: string | null
          provider_status: string | null
          round_name: string | null
          score_data: Json | null
          season_id: string | null
          season_label: string | null
          state_data: Json | null
          status: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      sports_football_match_summary_v: {
        Row: {
          away_score_data: Json | null
          away_team_id: string | null
          away_team_logo_url: string | null
          away_team_name: string | null
          competition_id: string | null
          competition_logo_url: string | null
          competition_name: string | null
          competition_short_name: string | null
          country_code: string | null
          country_flag_url: string | null
          country_id: string | null
          country_name: string | null
          home_score_data: Json | null
          home_team_id: string | null
          home_team_logo_url: string | null
          home_team_name: string | null
          kickoff_at: string | null
          match_id: string | null
          provider_status: string | null
          round_name: string | null
          score_data: Json | null
          season_id: string | null
          season_label: string | null
          state_data: Json | null
          status: string | null
          updated_at: string | null
          venue_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_highlightly_unavailable_odds_issues: {
        Args: never
        Returns: number
      }
      cancel_highlightly_redundant_shadow_jobs: {
        Args: { p_endpoint_keys: string[]; p_reason?: string; p_scope: string }
        Returns: number
      }
      claim_highlightly_ingestion_bridge_nonce: {
        Args: {
          p_expires_at: string
          p_nonce: string
          p_request_hash: string
          p_signed_at: string
        }
        Returns: boolean
      }
      claim_highlightly_ingestion_job: {
        Args: { p_lock_seconds?: number; p_worker_id: string }
        Returns: {
          attempts: number
          created_at: string
          cursor_data: Json
          dedupe_key: string
          endpoint_key: string
          finished_at: string | null
          id: string
          last_error: string | null
          lock_expires_at: string | null
          locked_at: string | null
          max_attempts: number
          priority: number
          reprocess_raw_object_id: string | null
          request_params: Json
          resource: string
          scheduled_at: string
          shadow_scope: string | null
          sport: string
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "hl_ingestion_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_highlightly_ingestion_job: {
        Args: {
          p_cursor_data?: Json
          p_dedupe_key: string
          p_endpoint_key: string
          p_max_attempts?: number
          p_priority?: number
          p_reprocess_raw_object_id?: string
          p_request_params?: Json
          p_resource: string
          p_scheduled_at?: string
          p_sport: string
        }
        Returns: {
          attempts: number
          created_at: string
          cursor_data: Json
          dedupe_key: string
          endpoint_key: string
          finished_at: string | null
          id: string
          last_error: string | null
          lock_expires_at: string | null
          locked_at: string | null
          max_attempts: number
          priority: number
          reprocess_raw_object_id: string | null
          request_params: Json
          resource: string
          scheduled_at: string
          shadow_scope: string | null
          sport: string
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "hl_ingestion_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_highlightly_ingestion_job: {
        Args: {
          p_error?: string
          p_job_id: string
          p_outcome: string
          p_retry_delay_seconds?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          created_at: string
          cursor_data: Json
          dedupe_key: string
          endpoint_key: string
          finished_at: string | null
          id: string
          last_error: string | null
          lock_expires_at: string | null
          locked_at: string | null
          max_attempts: number
          priority: number
          reprocess_raw_object_id: string | null
          request_params: Json
          resource: string
          scheduled_at: string
          shadow_scope: string | null
          sport: string
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "hl_ingestion_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_baseball_daily_matches: {
        Args: {
          p_cursor_kickoff?: string
          p_cursor_match_id?: string
          p_from: string
          p_limit?: number
          p_to: string
        }
        Returns: {
          away_score_data: Json | null
          away_starting_pitcher_id: string | null
          away_starting_pitcher_name: string | null
          away_starting_pitcher_status: string | null
          away_team_id: string | null
          away_team_logo_url: string | null
          away_team_name: string | null
          competition_id: string | null
          competition_name: string | null
          competition_short_name: string | null
          home_score_data: Json | null
          home_starting_pitcher_id: string | null
          home_starting_pitcher_name: string | null
          home_starting_pitcher_status: string | null
          home_team_id: string | null
          home_team_logo_url: string | null
          home_team_name: string | null
          kickoff_at: string | null
          match_id: string | null
          provider_status: string | null
          round_name: string | null
          score_data: Json | null
          season_id: string | null
          season_label: string | null
          state_data: Json | null
          status: string | null
          updated_at: string | null
          venue_name: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "sports_baseball_match_summary_v"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_baseball_match_detail: { Args: { p_match_id: string }; Returns: Json }
      get_basketball_daily_matches: {
        Args: {
          p_cursor_kickoff?: string
          p_cursor_match_id?: string
          p_from: string
          p_limit?: number
          p_to: string
        }
        Returns: {
          away_score_data: Json | null
          away_team_id: string | null
          away_team_logo_url: string | null
          away_team_name: string | null
          competition_id: string | null
          competition_name: string | null
          competition_short_name: string | null
          home_score_data: Json | null
          home_team_id: string | null
          home_team_logo_url: string | null
          home_team_name: string | null
          kickoff_at: string | null
          match_id: string | null
          provider_status: string | null
          round_name: string | null
          score_data: Json | null
          season_id: string | null
          season_label: string | null
          state_data: Json | null
          status: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "sports_basketball_match_summary_v"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_basketball_match_detail: {
        Args: { p_match_id: string }
        Returns: Json
      }
      get_football_daily_matches: {
        Args: {
          p_cursor_kickoff?: string
          p_cursor_match_id?: string
          p_from: string
          p_limit?: number
          p_to: string
        }
        Returns: {
          away_score_data: Json | null
          away_team_id: string | null
          away_team_logo_url: string | null
          away_team_name: string | null
          competition_id: string | null
          competition_logo_url: string | null
          competition_name: string | null
          competition_short_name: string | null
          country_code: string | null
          country_flag_url: string | null
          country_id: string | null
          country_name: string | null
          home_score_data: Json | null
          home_team_id: string | null
          home_team_logo_url: string | null
          home_team_name: string | null
          kickoff_at: string | null
          match_id: string | null
          provider_status: string | null
          round_name: string | null
          score_data: Json | null
          season_id: string | null
          season_label: string | null
          state_data: Json | null
          status: string | null
          updated_at: string | null
          venue_name: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "sports_football_match_summary_v"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_football_match_detail: { Args: { p_match_id: string }; Returns: Json }
      get_highlightly_daily_request_usage: {
        Args: { p_provider_id: string; p_request_date: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      prune_highlightly_ingestion_bridge_nonces: {
        Args: { p_before?: string; p_limit?: number }
        Returns: number
      }
      refresh_highlightly_shadow_observation: {
        Args: {
          p_matches_expected?: number
          p_observed_on: string
          p_scope: string
          p_sport: string
          p_window_id: string
        }
        Returns: {
          created_at: string
          freshness_p95_seconds: number | null
          id: string
          jobs_dead: number
          jobs_partial: number
          jobs_pending: number
          jobs_retry: number
          jobs_succeeded: number
          jobs_total: number
          latency_p50_ms: number | null
          latency_p95_ms: number | null
          match_coverage_pct: number | null
          matches_expected: number
          matches_seen: number
          matches_with_odds: number
          observed_on: string
          odds_coverage_pct: number | null
          open_critical_issues: number
          open_error_issues: number
          open_warning_issues: number
          requests_used: number
          source_metadata: Json
          sport: string
          updated_at: string
          window_id: string
        }
        SetofOptions: {
          from: "*"
          to: "hl_shadow_observations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_highlightly_source_reconciliation: {
        Args: { p_observed_on: string; p_sport: string; p_window_id: string }
        Returns: {
          competition_key: string
          coverage_pct: number | null
          created_at: string
          details: Json
          expected_matches: number
          extra_in_highlightly: number
          highlightly_matches: number
          id: string
          kickoff_divergences: number
          matched_matches: number
          missing_in_highlightly: number
          observed_on: string
          odds_divergences: number
          score_divergences: number
          source_name: string
          sport: string
          updated_at: string
          window_id: string
        }
        SetofOptions: {
          from: "*"
          to: "hl_source_reconciliations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_sports_odds_consensus: {
        Args: {
          p_match_id: string
          p_max_bookmakers?: number
          p_min_bookmakers?: number
          p_snapshot_at?: string
        }
        Returns: number
      }
      upsert_sports_odds_quote: {
        Args: {
          p_bookmaker_id: string
          p_collected_at?: string
          p_decimal_odds: number
          p_is_live: boolean
          p_line_key: string
          p_line_value: number
          p_market_definition_id: string
          p_match_id: string
          p_provider_updated_at?: string
          p_quote_status: string
          p_selection_key: string
          p_selection_name: string
          p_source_raw_object_id?: string
        }
        Returns: {
          bookmaker_id: string
          created_at: string
          decimal_odds: number
          first_seen_at: string
          id: string
          is_live: boolean
          last_seen_at: string
          line_key: string
          line_value: number | null
          market_definition_id: string
          match_id: string
          provider_updated_at: string | null
          quote_status: string
          selection_key: string
          selection_name: string
          source_raw_object_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sports_odds_current"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_sports_odds_quotes: {
        Args: { p_quotes: Json }
        Returns: {
          bookmaker_id: string
          created_at: string
          decimal_odds: number
          first_seen_at: string
          id: string
          is_live: boolean
          last_seen_at: string
          line_key: string
          line_value: number | null
          market_definition_id: string
          match_id: string
          provider_updated_at: string | null
          quote_status: string
          selection_key: string
          selection_name: string
          source_raw_object_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sports_odds_current"
          isOneToOne: false
          isSetofReturn: true
        }
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
