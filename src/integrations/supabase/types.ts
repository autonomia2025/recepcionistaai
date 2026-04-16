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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      api_usage: {
        Row: {
          ai_calls: number
          ai_cost_usd: number
          ai_tokens_used: number
          conversations_auto_resolved: number
          conversations_handled: number
          created_at: string
          estimated_minutes_saved: number
          id: string
          updated_at: string
          usage_date: string
          whatsapp_cost_usd: number
          whatsapp_messages_received: number
          whatsapp_messages_sent: number
          workshop_id: string | null
        }
        Insert: {
          ai_calls?: number
          ai_cost_usd?: number
          ai_tokens_used?: number
          conversations_auto_resolved?: number
          conversations_handled?: number
          created_at?: string
          estimated_minutes_saved?: number
          id?: string
          updated_at?: string
          usage_date?: string
          whatsapp_cost_usd?: number
          whatsapp_messages_received?: number
          whatsapp_messages_sent?: number
          workshop_id?: string | null
        }
        Update: {
          ai_calls?: number
          ai_cost_usd?: number
          ai_tokens_used?: number
          conversations_auto_resolved?: number
          conversations_handled?: number
          created_at?: string
          estimated_minutes_saved?: number
          id?: string
          updated_at?: string
          usage_date?: string
          whatsapp_cost_usd?: number
          whatsapp_messages_received?: number
          whatsapp_messages_sent?: number
          workshop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_usage_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_actions: {
        Row: {
          action_source: string
          action_token: string | null
          action_type: string
          appointment_id: string
          created_at: string
          id: string
          ip_address: string | null
          user_agent: string | null
          workshop_id: string
        }
        Insert: {
          action_source: string
          action_token?: string | null
          action_type: string
          appointment_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          workshop_id: string
        }
        Update: {
          action_source?: string
          action_token?: string | null
          action_type?: string
          appointment_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_actions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_actions_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_actions_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          assigned_to_user_id: string | null
          cancel_token: string | null
          confirmed_at: string | null
          confirmed_via: string | null
          contact_id: string
          created_at: string
          end_datetime: string
          id: string
          notes: string | null
          original_appointment_id: string | null
          reminder_24h_sent_at: string | null
          reminder_2h_sent_at: string | null
          service_type: string
          start_datetime: string
          status: Database["public"]["Enums"]["appointment_status"]
          workshop_id: string
        }
        Insert: {
          assigned_to_user_id?: string | null
          cancel_token?: string | null
          confirmed_at?: string | null
          confirmed_via?: string | null
          contact_id: string
          created_at?: string
          end_datetime: string
          id?: string
          notes?: string | null
          original_appointment_id?: string | null
          reminder_24h_sent_at?: string | null
          reminder_2h_sent_at?: string | null
          service_type: string
          start_datetime: string
          status?: Database["public"]["Enums"]["appointment_status"]
          workshop_id: string
        }
        Update: {
          assigned_to_user_id?: string | null
          cancel_token?: string | null
          confirmed_at?: string | null
          confirmed_via?: string | null
          contact_id?: string
          created_at?: string
          end_datetime?: string
          id?: string
          notes?: string | null
          original_appointment_id?: string | null
          reminder_24h_sent_at?: string | null
          reminder_2h_sent_at?: string | null
          service_type?: string
          start_datetime?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_original_appointment_id_fkey"
            columns: ["original_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      automations_settings: {
        Row: {
          confirm_24h: boolean
          followup_no_booking: boolean
          reengagement_6_months: boolean
          remind_3h: boolean
          reminder_24h_body: string | null
          reminder_24h_subject: string | null
          reminder_3h_body: string | null
          reminder_3h_subject: string | null
          updated_at: string
          workshop_id: string
        }
        Insert: {
          confirm_24h?: boolean
          followup_no_booking?: boolean
          reengagement_6_months?: boolean
          remind_3h?: boolean
          reminder_24h_body?: string | null
          reminder_24h_subject?: string | null
          reminder_3h_body?: string | null
          reminder_3h_subject?: string | null
          updated_at?: string
          workshop_id: string
        }
        Update: {
          confirm_24h?: boolean
          followup_no_booking?: boolean
          reengagement_6_months?: boolean
          remind_3h?: boolean
          reminder_24h_body?: string | null
          reminder_24h_subject?: string | null
          reminder_3h_body?: string | null
          reminder_3h_subject?: string | null
          updated_at?: string
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_settings_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_settings_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          amount_clp: number | null
          amount_usd: number | null
          created_at: string
          description: string | null
          event_type: string
          id: string
          metadata: Json | null
          stripe_event_id: string | null
          subscription_id: string | null
          workshop_id: string
        }
        Insert: {
          amount_clp?: number | null
          amount_usd?: number | null
          created_at?: string
          description?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          stripe_event_id?: string | null
          subscription_id?: string | null
          workshop_id: string
        }
        Update: {
          amount_clp?: number | null
          amount_usd?: number | null
          created_at?: string
          description?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          stripe_event_id?: string | null
          subscription_id?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_numbers: {
        Row: {
          created_at: string
          id: string
          phone_number: string
          reason: string | null
          workshop_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          phone_number: string
          reason?: string | null
          workshop_id: string
        }
        Update: {
          created_at?: string
          id?: string
          phone_number?: string
          reason?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_numbers_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_numbers_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_documents: {
        Row: {
          chunk_count: number | null
          created_at: string | null
          error_message: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          id: string
          status: string | null
          workshop_id: string
        }
        Insert: {
          chunk_count?: number | null
          created_at?: string | null
          error_message?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          status?: string | null
          workshop_id: string
        }
        Update: {
          chunk_count?: number | null
          created_at?: string | null
          error_message?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          status?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_documents_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_documents_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_knowledge: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          document_id: string
          embedding: string | null
          file_name: string
          id: string
          metadata: Json | null
          workshop_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          document_id: string
          embedding?: string | null
          file_name: string
          id?: string
          metadata?: Json | null
          workshop_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          document_id?: string
          embedding?: string | null
          file_name?: string
          id?: string
          metadata?: Json | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_knowledge_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "bot_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_knowledge_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_knowledge_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_settings: {
        Row: {
          business_description: string | null
          faq_json: Json | null
          handoff_rules_json: Json | null
          services_json: Json | null
          system_prompt: string | null
          tone: string | null
          updated_at: string
          urgency_rules_json: Json | null
          workshop_id: string
        }
        Insert: {
          business_description?: string | null
          faq_json?: Json | null
          handoff_rules_json?: Json | null
          services_json?: Json | null
          system_prompt?: string | null
          tone?: string | null
          updated_at?: string
          urgency_rules_json?: Json | null
          workshop_id: string
        }
        Update: {
          business_description?: string | null
          faq_json?: Json | null
          handoff_rules_json?: Json | null
          services_json?: Json | null
          system_prompt?: string | null
          tone?: string | null
          updated_at?: string
          urgency_rules_json?: Json | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_settings_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_settings_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          appointment_id: string | null
          contact_id: string | null
          created_at: string | null
          description: string | null
          end_time: string
          event_type: string
          google_event_id: string | null
          id: string
          is_all_day: boolean | null
          start_time: string
          synced_at: string | null
          title: string
          updated_at: string | null
          user_id: string | null
          workshop_id: string
        }
        Insert: {
          appointment_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          end_time: string
          event_type?: string
          google_event_id?: string | null
          id?: string
          is_all_day?: boolean | null
          start_time: string
          synced_at?: string | null
          title: string
          updated_at?: string | null
          user_id?: string | null
          workshop_id: string
        }
        Update: {
          appointment_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          end_time?: string
          event_type?: string
          google_event_id?: string | null
          id?: string
          is_all_day?: boolean | null
          start_time?: string
          synced_at?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          archived: boolean | null
          closed_at: string | null
          created_at: string
          detected_intent: string | null
          did_schedule: boolean | null
          email: string | null
          id: string
          instagram_id: string | null
          intent_confidence: number | null
          last_analyzed_at: string | null
          lead_score: number | null
          lead_score_reasoning: string | null
          name: string
          notes: string | null
          phone: string | null
          quote_sent: boolean | null
          quote_sent_at: string | null
          recontact_at: string | null
          recontact_reason: string | null
          schedule_confidence: number | null
          should_recontact: boolean | null
          tags: string[] | null
          vehicle_brand: string | null
          vehicle_model: string | null
          vehicle_year: number | null
          web_session_id: string | null
          whatsapp_id: string | null
          workshop_id: string
          zone: string | null
        }
        Insert: {
          archived?: boolean | null
          closed_at?: string | null
          created_at?: string
          detected_intent?: string | null
          did_schedule?: boolean | null
          email?: string | null
          id?: string
          instagram_id?: string | null
          intent_confidence?: number | null
          last_analyzed_at?: string | null
          lead_score?: number | null
          lead_score_reasoning?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          quote_sent?: boolean | null
          quote_sent_at?: string | null
          recontact_at?: string | null
          recontact_reason?: string | null
          schedule_confidence?: number | null
          should_recontact?: boolean | null
          tags?: string[] | null
          vehicle_brand?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          web_session_id?: string | null
          whatsapp_id?: string | null
          workshop_id: string
          zone?: string | null
        }
        Update: {
          archived?: boolean | null
          closed_at?: string | null
          created_at?: string
          detected_intent?: string | null
          did_schedule?: boolean | null
          email?: string | null
          id?: string
          instagram_id?: string | null
          intent_confidence?: number | null
          last_analyzed_at?: string | null
          lead_score?: number | null
          lead_score_reasoning?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          quote_sent?: boolean | null
          quote_sent_at?: string | null
          recontact_at?: string | null
          recontact_reason?: string | null
          schedule_confidence?: number | null
          should_recontact?: boolean | null
          tags?: string[] | null
          vehicle_brand?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          web_session_id?: string | null
          whatsapp_id?: string | null
          workshop_id?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_summary: string | null
          assigned_to_user_id: string | null
          bot_paused: boolean | null
          contact_id: string
          created_at: string
          id: string
          last_message_at: string | null
          last_message_text: string | null
          sentiment: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          workshop_id: string
        }
        Insert: {
          ai_summary?: string | null
          assigned_to_user_id?: string | null
          bot_paused?: boolean | null
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_text?: string | null
          sentiment?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          workshop_id: string
        }
        Update: {
          ai_summary?: string | null
          assigned_to_user_id?: string | null
          bot_paused?: boolean | null
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_text?: string | null
          sentiment?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      email_reminder_logs: {
        Row: {
          appointment_id: string
          email_to: string
          error_message: string | null
          id: string
          reminder_type: string
          sent_at: string
          status: string | null
          workshop_id: string
        }
        Insert: {
          appointment_id: string
          email_to: string
          error_message?: string | null
          id?: string
          reminder_type: string
          sent_at?: string
          status?: string | null
          workshop_id: string
        }
        Update: {
          appointment_id?: string
          email_to?: string
          error_message?: string | null
          id?: string
          reminder_type?: string
          sent_at?: string
          status?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_reminder_logs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_reminder_logs_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_reminder_logs_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      health_logs: {
        Row: {
          category: string
          created_at: string
          event_type: string
          id: string
          message: string
          metadata: Json | null
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          workshop_id: string
        }
        Insert: {
          category: string
          created_at?: string
          event_type: string
          id?: string
          message: string
          metadata?: Json | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          workshop_id: string
        }
        Update: {
          category?: string
          created_at?: string
          event_type?: string
          id?: string
          message?: string
          metadata?: Json | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_logs_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_logs_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_logs_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          last_checked_at: string | null
          metadata: Json | null
          provider: string
          status: string
          updated_at: string
          workshop_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_checked_at?: string | null
          metadata?: Json | null
          provider: string
          status?: string
          updated_at?: string
          workshop_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_checked_at?: string | null
          metadata?: Json | null
          provider?: string
          status?: string
          updated_at?: string
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrations_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_notification_logs: {
        Row: {
          appointment_id: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          email_subject: string
          email_to: string
          error_message: string | null
          id: string
          notification_type: string
          service_request_id: string | null
          status: string | null
          workshop_id: string
        }
        Insert: {
          appointment_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          email_subject: string
          email_to: string
          error_message?: string | null
          id?: string
          notification_type: string
          service_request_id?: string | null
          status?: string | null
          workshop_id: string
        }
        Update: {
          appointment_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          email_subject?: string
          email_to?: string
          error_message?: string | null
          id?: string
          notification_type?: string
          service_request_id?: string | null
          status?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_notification_logs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notification_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notification_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notification_logs_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notification_logs_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notification_logs_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["invite_status"]
          token: string
          workshop_id: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
          workshop_id: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_config: {
        Row: {
          buffer_minutes: number | null
          business_name: string | null
          cancellation_policy: string | null
          confirmation_message: string | null
          created_at: string | null
          default_schedule: Json | null
          id: string
          is_published: boolean | null
          logo_url: string | null
          lunch_break_end: string | null
          lunch_break_start: string | null
          primary_color: string | null
          published_at: string | null
          require_email: boolean | null
          require_name: boolean | null
          require_phone: boolean | null
          require_reason: boolean | null
          updated_at: string | null
          welcome_message: string | null
          wizard_completed: boolean | null
          wizard_current_step: number | null
          workshop_id: string
        }
        Insert: {
          buffer_minutes?: number | null
          business_name?: string | null
          cancellation_policy?: string | null
          confirmation_message?: string | null
          created_at?: string | null
          default_schedule?: Json | null
          id?: string
          is_published?: boolean | null
          logo_url?: string | null
          lunch_break_end?: string | null
          lunch_break_start?: string | null
          primary_color?: string | null
          published_at?: string | null
          require_email?: boolean | null
          require_name?: boolean | null
          require_phone?: boolean | null
          require_reason?: boolean | null
          updated_at?: string | null
          welcome_message?: string | null
          wizard_completed?: boolean | null
          wizard_current_step?: number | null
          workshop_id: string
        }
        Update: {
          buffer_minutes?: number | null
          business_name?: string | null
          cancellation_policy?: string | null
          confirmation_message?: string | null
          created_at?: string | null
          default_schedule?: Json | null
          id?: string
          is_published?: boolean | null
          logo_url?: string | null
          lunch_break_end?: string | null
          lunch_break_start?: string | null
          primary_color?: string | null
          published_at?: string | null
          require_email?: boolean | null
          require_name?: boolean | null
          require_phone?: boolean | null
          require_reason?: boolean | null
          updated_at?: string | null
          welcome_message?: string | null
          wizard_completed?: boolean | null
          wizard_current_step?: number | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "landing_config_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_config_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_services: {
        Row: {
          created_at: string | null
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean | null
          name: string
          price: number | null
          sort_order: number | null
          workshop_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean | null
          name: string
          price?: number | null
          sort_order?: number | null
          workshop_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number | null
          sort_order?: number | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "landing_services_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_services_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_team: {
        Row: {
          created_at: string | null
          id: string
          name: string
          photo_url: string | null
          profile_id: string | null
          role: string | null
          show_on_landing: boolean | null
          sort_order: number | null
          workshop_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          photo_url?: string | null
          profile_id?: string | null
          role?: string | null
          show_on_landing?: boolean | null
          sort_order?: number | null
          workshop_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          photo_url?: string | null
          profile_id?: string | null
          role?: string | null
          show_on_landing?: boolean | null
          sort_order?: number | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "landing_team_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_team_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_team_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_leads: {
        Row: {
          company: string | null
          created_at: string
          email: string
          id: string
          industry: string | null
          message: string | null
          metadata: Json | null
          name: string
          owner: string | null
          phone: string | null
          source: string | null
          status: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          email: string
          id?: string
          industry?: string | null
          message?: string | null
          metadata?: Json | null
          name: string
          owner?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string
          id?: string
          industry?: string | null
          message?: string | null
          metadata?: Json | null
          name?: string
          owner?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_leads_owner_fkey"
            columns: ["owner"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_batches: {
        Row: {
          batch_started_at: string
          conversation_id: string
          created_at: string
          id: string
          is_completed: boolean
          is_processing: boolean
          last_message_at: string
          message_count: number
          workshop_id: string
        }
        Insert: {
          batch_started_at?: string
          conversation_id: string
          created_at?: string
          id?: string
          is_completed?: boolean
          is_processing?: boolean
          last_message_at?: string
          message_count?: number
          workshop_id: string
        }
        Update: {
          batch_started_at?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_completed?: boolean
          is_processing?: boolean
          last_message_at?: string
          message_count?: number
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_batches_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_batches_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_batches_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          channel: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          metadata: Json | null
          text: string
          workshop_id: string
        }
        Insert: {
          channel?: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          metadata?: Json | null
          text: string
          workshop_id: string
        }
        Update: {
          channel?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          metadata?: Json | null
          text?: string
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_reports: {
        Row: {
          appointments_count: number | null
          avg_response_time_minutes: number | null
          conversations_count: number | null
          conversion_rate: number | null
          emailed_at: string | null
          generated_at: string
          handoffs_count: number | null
          hot_leads_count: number | null
          id: string
          report_month: string
          top_intents: Json | null
          workshop_id: string
        }
        Insert: {
          appointments_count?: number | null
          avg_response_time_minutes?: number | null
          conversations_count?: number | null
          conversion_rate?: number | null
          emailed_at?: string | null
          generated_at?: string
          handoffs_count?: number | null
          hot_leads_count?: number | null
          id?: string
          report_month: string
          top_intents?: Json | null
          workshop_id: string
        }
        Update: {
          appointments_count?: number | null
          avg_response_time_minutes?: number | null
          conversations_count?: number | null
          conversion_rate?: number | null
          emailed_at?: string | null
          generated_at?: string
          handoffs_count?: number | null
          hot_leads_count?: number | null
          id?: string
          report_month?: string
          top_intents?: Json | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_reports_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          appointment_id: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          notes: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string | null
          workshop_id: string
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          notes?: string | null
          read_at?: string | null
          title: string
          type?: string
          user_id?: string | null
          workshop_id: string
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          notes?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_records: {
        Row: {
          amount_clp: number
          created_at: string | null
          id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
          payment_type: string
          period_end: string | null
          period_start: string | null
          receipt_number: string | null
          recorded_by: string | null
          workshop_id: string
        }
        Insert: {
          amount_clp: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date: string
          payment_method?: string | null
          payment_type: string
          period_end?: string | null
          period_start?: string | null
          receipt_number?: string | null
          recorded_by?: string | null
          workshop_id: string
        }
        Update: {
          amount_clp?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          payment_type?: string
          period_end?: string | null
          period_start?: string | null
          receipt_number?: string | null
          recorded_by?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          id: string
          max_users: number | null
          name: string
          price_clp: number
        }
        Insert: {
          created_at?: string
          id?: string
          max_users?: number | null
          name: string
          price_clp?: number
        }
        Update: {
          created_at?: string
          id?: string
          max_users?: number | null
          name?: string
          price_clp?: number
        }
        Relationships: []
      }
      platform_stats: {
        Row: {
          active_workshops: number
          created_at: string
          id: string
          stat_date: string
          total_ai_cost_usd: number
          total_auto_resolved: number
          total_conversations: number
          total_messages: number
          total_minutes_saved: number
          total_whatsapp_cost_usd: number
          total_workshops: number
        }
        Insert: {
          active_workshops?: number
          created_at?: string
          id?: string
          stat_date?: string
          total_ai_cost_usd?: number
          total_auto_resolved?: number
          total_conversations?: number
          total_messages?: number
          total_minutes_saved?: number
          total_whatsapp_cost_usd?: number
          total_workshops?: number
        }
        Update: {
          active_workshops?: number
          created_at?: string
          id?: string
          stat_date?: string
          total_ai_cost_usd?: number
          total_auto_resolved?: number
          total_conversations?: number
          total_messages?: number
          total_minutes_saved?: number
          total_whatsapp_cost_usd?: number
          total_workshops?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          google_calendar_connected: boolean | null
          google_calendar_email: string | null
          google_calendar_id: string | null
          google_connected_at: string | null
          google_refresh_token: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["user_status"]
          workshop_id: string | null
          zone: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          google_calendar_connected?: boolean | null
          google_calendar_email?: string | null
          google_calendar_id?: string | null
          google_connected_at?: string | null
          google_refresh_token?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["user_status"]
          workshop_id?: string | null
          zone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          google_calendar_connected?: boolean | null
          google_calendar_email?: string | null
          google_calendar_id?: string | null
          google_connected_at?: string | null
          google_refresh_token?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["user_status"]
          workshop_id?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_items: {
        Row: {
          address: string | null
          confidence: number | null
          contact_id: string
          conversation_id: string | null
          created_at: string | null
          currency: string | null
          duration: string | null
          extracted_at: string | null
          id: string
          location: string | null
          product_name: string
          quantity: number | null
          specifications: Json | null
          status: string | null
          total_price: number | null
          unit: string | null
          unit_price: number | null
          use_type: string | null
          workshop_id: string
        }
        Insert: {
          address?: string | null
          confidence?: number | null
          contact_id: string
          conversation_id?: string | null
          created_at?: string | null
          currency?: string | null
          duration?: string | null
          extracted_at?: string | null
          id?: string
          location?: string | null
          product_name: string
          quantity?: number | null
          specifications?: Json | null
          status?: string | null
          total_price?: number | null
          unit?: string | null
          unit_price?: number | null
          use_type?: string | null
          workshop_id: string
        }
        Update: {
          address?: string | null
          confidence?: number | null
          contact_id?: string
          conversation_id?: string | null
          created_at?: string | null
          currency?: string | null
          duration?: string | null
          extracted_at?: string | null
          id?: string
          location?: string | null
          product_name?: string
          quantity?: number | null
          specifications?: Json | null
          status?: string | null
          total_price?: number | null
          unit?: string | null
          unit_price?: number | null
          use_type?: string | null
          workshop_id?: string
        }
        Relationships: []
      }
      reminder_logs: {
        Row: {
          appointment_id: string | null
          contact_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          message_sent: string | null
          message_type: string
          provider_message_id: string | null
          reminder_type: string
          status: string | null
          template_name: string | null
          workshop_id: string
        }
        Insert: {
          appointment_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          message_sent?: string | null
          message_type: string
          provider_message_id?: string | null
          reminder_type: string
          status?: string | null
          template_name?: string | null
          workshop_id: string
        }
        Update: {
          appointment_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          message_sent?: string | null
          message_type?: string
          provider_message_id?: string | null
          reminder_type?: string
          status?: string | null
          template_name?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_logs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          address: string | null
          assigned_staff_id: string | null
          comuna: string | null
          contact_id: string
          conversation_id: string | null
          created_at: string
          description: string | null
          estimated_value: number | null
          id: string
          notes: string | null
          preferred_time_window: string | null
          service_category: string
          source: Database["public"]["Enums"]["request_source"]
          status: Database["public"]["Enums"]["service_request_status"]
          updated_at: string
          urgency: Database["public"]["Enums"]["request_urgency"]
          workshop_id: string
        }
        Insert: {
          address?: string | null
          assigned_staff_id?: string | null
          comuna?: string | null
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          estimated_value?: number | null
          id?: string
          notes?: string | null
          preferred_time_window?: string | null
          service_category: string
          source?: Database["public"]["Enums"]["request_source"]
          status?: Database["public"]["Enums"]["service_request_status"]
          updated_at?: string
          urgency?: Database["public"]["Enums"]["request_urgency"]
          workshop_id: string
        }
        Update: {
          address?: string | null
          assigned_staff_id?: string | null
          comuna?: string | null
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          estimated_value?: number | null
          id?: string
          notes?: string | null
          preferred_time_window?: string | null
          service_category?: string
          source?: Database["public"]["Enums"]["request_source"]
          status?: Database["public"]["Enums"]["service_request_status"]
          updated_at?: string
          urgency?: Database["public"]["Enums"]["request_urgency"]
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          max_users: number | null
          plan_id: string
          started_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          workshop_id: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          max_users?: number | null
          plan_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          workshop_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          max_users?: number | null
          plan_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      system_alerts: {
        Row: {
          created_at: string
          id: string
          message: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          title: string
          type: string
          workshop_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          title: string
          type: string
          workshop_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          title?: string
          type?: string
          workshop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_alerts_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_alerts_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
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
      web_chat_logs: {
        Row: {
          bot_reply_preview: string | null
          created_at: string
          event_type: string
          id: string
          message_preview: string | null
          metadata: Json | null
          origin: string | null
          session_id: string
          workshop_id: string
        }
        Insert: {
          bot_reply_preview?: string | null
          created_at?: string
          event_type: string
          id?: string
          message_preview?: string | null
          metadata?: Json | null
          origin?: string | null
          session_id: string
          workshop_id: string
        }
        Update: {
          bot_reply_preview?: string | null
          created_at?: string
          event_type?: string
          id?: string
          message_preview?: string | null
          metadata?: Json | null
          origin?: string | null
          session_id?: string
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_chat_logs_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_chat_logs_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_billing: {
        Row: {
          billing_contact_email: string | null
          billing_contact_name: string | null
          billing_contact_phone: string | null
          billing_day: number | null
          created_at: string | null
          discount_ends_at: string | null
          discount_percent: number | null
          id: string
          internal_notes: string | null
          last_payment_amount: number | null
          last_payment_date: string | null
          monthly_fee_clp: number | null
          next_billing_date: string | null
          payment_method: string | null
          payment_status: string | null
          razon_social: string | null
          rut: string | null
          setup_fee_clp: number | null
          setup_fee_paid: boolean | null
          setup_notes: string | null
          setup_paid_at: string | null
          updated_at: string | null
          workshop_id: string
        }
        Insert: {
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          billing_contact_phone?: string | null
          billing_day?: number | null
          created_at?: string | null
          discount_ends_at?: string | null
          discount_percent?: number | null
          id?: string
          internal_notes?: string | null
          last_payment_amount?: number | null
          last_payment_date?: string | null
          monthly_fee_clp?: number | null
          next_billing_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          razon_social?: string | null
          rut?: string | null
          setup_fee_clp?: number | null
          setup_fee_paid?: boolean | null
          setup_notes?: string | null
          setup_paid_at?: string | null
          updated_at?: string | null
          workshop_id: string
        }
        Update: {
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          billing_contact_phone?: string | null
          billing_day?: number | null
          created_at?: string | null
          discount_ends_at?: string | null
          discount_percent?: number | null
          id?: string
          internal_notes?: string | null
          last_payment_amount?: number | null
          last_payment_date?: string | null
          monthly_fee_clp?: number | null
          next_billing_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          razon_social?: string | null
          rut?: string | null
          setup_fee_clp?: number | null
          setup_fee_paid?: boolean | null
          setup_notes?: string | null
          setup_paid_at?: string | null
          updated_at?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshop_billing_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshop_billing_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_gmail_tokens: {
        Row: {
          access_token: string | null
          connected_at: string
          created_at: string
          gmail_email: string
          id: string
          last_used_at: string | null
          refresh_token: string
          token_expires_at: string | null
          updated_at: string
          workshop_id: string
        }
        Insert: {
          access_token?: string | null
          connected_at?: string
          created_at?: string
          gmail_email: string
          id?: string
          last_used_at?: string | null
          refresh_token: string
          token_expires_at?: string | null
          updated_at?: string
          workshop_id: string
        }
        Update: {
          access_token?: string | null
          connected_at?: string
          created_at?: string
          gmail_email?: string
          id?: string
          last_used_at?: string | null
          refresh_token?: string
          token_expires_at?: string | null
          updated_at?: string
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshop_gmail_tokens_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "superadmin_workshops_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshop_gmail_tokens_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: true
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      workshops: {
        Row: {
          address: string | null
          admin_notification_email: string | null
          booking_mode: string
          booking_url: string | null
          bot_enabled: boolean | null
          category: string | null
          city: string | null
          created_at: string
          email_button_color: string | null
          email_logo_url: string | null
          email_monthly_report: boolean | null
          email_notifications_appointment: boolean | null
          email_notifications_handoff: boolean | null
          email_notifications_hot_lead: boolean | null
          email_notifications_quotation: boolean | null
          email_primary_color: string | null
          email_reminders_enabled: boolean | null
          email_sender_name: string | null
          email_use_branding: boolean | null
          gmail_connected: boolean | null
          gmail_connected_at: string | null
          gmail_email: string | null
          gmail_refresh_token: string | null
          id: string
          instagram_access_token: string | null
          instagram_connected: boolean | null
          instagram_connected_at: string | null
          instagram_page_id: string | null
          is_active: boolean
          name: string
          phone: string | null
          slug: string | null
          twilio_phone_number: string | null
          twilio_phone_sid: string | null
          web_chat_allowed_domains: string[] | null
          web_chat_enabled: boolean | null
          web_chat_position: string | null
          web_chat_primary_color: string | null
          web_chat_title: string | null
          web_chat_welcome_message: string | null
          web_chat_z_index: string | null
          whatsapp_access_token: string | null
          whatsapp_business_account_id: string | null
          whatsapp_connected: boolean | null
          whatsapp_connected_at: string | null
          whatsapp_phone_number_id: string | null
          whatsapp_provider: string
          whatsapp_verify_token: string | null
          zone_notification_emails: Json | null
        }
        Insert: {
          address?: string | null
          admin_notification_email?: string | null
          booking_mode?: string
          booking_url?: string | null
          bot_enabled?: boolean | null
          category?: string | null
          city?: string | null
          created_at?: string
          email_button_color?: string | null
          email_logo_url?: string | null
          email_monthly_report?: boolean | null
          email_notifications_appointment?: boolean | null
          email_notifications_handoff?: boolean | null
          email_notifications_hot_lead?: boolean | null
          email_notifications_quotation?: boolean | null
          email_primary_color?: string | null
          email_reminders_enabled?: boolean | null
          email_sender_name?: string | null
          email_use_branding?: boolean | null
          gmail_connected?: boolean | null
          gmail_connected_at?: string | null
          gmail_email?: string | null
          gmail_refresh_token?: string | null
          id?: string
          instagram_access_token?: string | null
          instagram_connected?: boolean | null
          instagram_connected_at?: string | null
          instagram_page_id?: string | null
          is_active?: boolean
          name: string
          phone?: string | null
          slug?: string | null
          twilio_phone_number?: string | null
          twilio_phone_sid?: string | null
          web_chat_allowed_domains?: string[] | null
          web_chat_enabled?: boolean | null
          web_chat_position?: string | null
          web_chat_primary_color?: string | null
          web_chat_title?: string | null
          web_chat_welcome_message?: string | null
          web_chat_z_index?: string | null
          whatsapp_access_token?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_connected?: boolean | null
          whatsapp_connected_at?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_provider?: string
          whatsapp_verify_token?: string | null
          zone_notification_emails?: Json | null
        }
        Update: {
          address?: string | null
          admin_notification_email?: string | null
          booking_mode?: string
          booking_url?: string | null
          bot_enabled?: boolean | null
          category?: string | null
          city?: string | null
          created_at?: string
          email_button_color?: string | null
          email_logo_url?: string | null
          email_monthly_report?: boolean | null
          email_notifications_appointment?: boolean | null
          email_notifications_handoff?: boolean | null
          email_notifications_hot_lead?: boolean | null
          email_notifications_quotation?: boolean | null
          email_primary_color?: string | null
          email_reminders_enabled?: boolean | null
          email_sender_name?: string | null
          email_use_branding?: boolean | null
          gmail_connected?: boolean | null
          gmail_connected_at?: string | null
          gmail_email?: string | null
          gmail_refresh_token?: string | null
          id?: string
          instagram_access_token?: string | null
          instagram_connected?: boolean | null
          instagram_connected_at?: string | null
          instagram_page_id?: string | null
          is_active?: boolean
          name?: string
          phone?: string | null
          slug?: string | null
          twilio_phone_number?: string | null
          twilio_phone_sid?: string | null
          web_chat_allowed_domains?: string[] | null
          web_chat_enabled?: boolean | null
          web_chat_position?: string | null
          web_chat_primary_color?: string | null
          web_chat_title?: string | null
          web_chat_welcome_message?: string | null
          web_chat_z_index?: string | null
          whatsapp_access_token?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_connected?: boolean | null
          whatsapp_connected_at?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_provider?: string
          whatsapp_verify_token?: string | null
          zone_notification_emails?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      superadmin_workshops_view: {
        Row: {
          appointments_30d: number | null
          churn_risk: string | null
          conversations_7d: number | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          last_activity: string | null
          name: string | null
          plan_name: string | null
          plan_price: number | null
          slug: string | null
          staff_count: number | null
          subscription_ends: string | null
          subscription_started: string | null
          subscription_status:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          whatsapp_connected: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invite: { Args: { invite_token: string }; Returns: Json }
      get_churn_risk: { Args: { p_workshop_id: string }; Returns: string }
      get_conversation_messages: {
        Args: { _conversation_id: string }
        Returns: {
          channel: string
          conversation_id: string
          created_at: string
          direction: string
          id: string
          metadata: Json
          text: string
          workshop_id: string
        }[]
      }
      get_invite_by_token: {
        Args: { invite_token: string }
        Returns: {
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["invite_status"]
          workshop_id: string
          workshop_name: string
        }[]
      }
      get_public_calendar_events: {
        Args: {
          _end: string
          _start: string
          _user_id: string
          _workshop_id: string
        }
        Returns: {
          end_time: string
          start_time: string
          user_id: string
        }[]
      }
      get_public_workshop_by_slug: {
        Args: { _slug: string }
        Returns: {
          address: string
          booking_mode: string
          category: string
          city: string
          id: string
          is_active: boolean
          name: string
          slug: string
        }[]
      }
      get_superadmin_kpis: { Args: never; Returns: Json }
      get_user_workshop_id: { Args: { _user_id: string }; Returns: string }
      get_workshop_health_status: {
        Args: { p_workshop_id: string }
        Returns: Json
      }
      get_workshop_profiles: {
        Args: { _workshop_id: string }
        Returns: {
          created_at: string
          email: string
          full_name: string
          google_calendar_connected: boolean
          google_calendar_email: string
          google_connected_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["user_status"]
          workshop_id: string
        }[]
      }
      get_workshop_seats: {
        Args: { _workshop_id: string }
        Returns: {
          max_seats: number
          used_seats: number
        }[]
      }
      get_workshop_staff_public: {
        Args: { _workshop_id: string }
        Returns: {
          full_name: string
          id: string
        }[]
      }
      get_workshop_stats: { Args: { p_workshop_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_number_blocked: {
        Args: { _phone: string; _workshop_id: string }
        Returns: boolean
      }
      is_superadmin: { Args: { _user_id: string }; Returns: boolean }
      is_workshop_active: { Args: { _workshop_id: string }; Returns: boolean }
      match_bot_knowledge: {
        Args: {
          match_count?: number
          match_threshold?: number
          p_workshop_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          file_name: string
          id: string
          similarity: number
        }[]
      }
    }
    Enums: {
      app_role: "SUPERADMIN" | "ADMIN" | "STAFF"
      appointment_status:
        | "scheduled"
        | "confirmed"
        | "completed"
        | "no_show"
        | "canceled"
      conversation_status: "new" | "in_progress" | "booked" | "closed" | "lost"
      invite_status: "pending" | "accepted" | "expired"
      message_direction: "inbound" | "outbound"
      request_source: "whatsapp" | "manual" | "web"
      request_urgency: "low" | "medium" | "high"
      service_request_status:
        | "new"
        | "contacting"
        | "waiting_customer"
        | "scheduled_visit"
        | "quoted"
        | "approved"
        | "in_progress"
        | "done"
        | "lost"
      subscription_status: "active" | "trial" | "past_due" | "canceled"
      user_status: "active" | "invited" | "disabled"
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
      app_role: ["SUPERADMIN", "ADMIN", "STAFF"],
      appointment_status: [
        "scheduled",
        "confirmed",
        "completed",
        "no_show",
        "canceled",
      ],
      conversation_status: ["new", "in_progress", "booked", "closed", "lost"],
      invite_status: ["pending", "accepted", "expired"],
      message_direction: ["inbound", "outbound"],
      request_source: ["whatsapp", "manual", "web"],
      request_urgency: ["low", "medium", "high"],
      service_request_status: [
        "new",
        "contacting",
        "waiting_customer",
        "scheduled_visit",
        "quoted",
        "approved",
        "in_progress",
        "done",
        "lost",
      ],
      subscription_status: ["active", "trial", "past_due", "canceled"],
      user_status: ["active", "invited", "disabled"],
    },
  },
} as const
