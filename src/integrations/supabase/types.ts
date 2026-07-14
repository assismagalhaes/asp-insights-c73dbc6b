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
