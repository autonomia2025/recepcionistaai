import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'SUPERADMIN' | 'ADMIN' | 'STAFF';

interface Profile {
  id: string;
  workshop_id: string | null;
  full_name: string;
  email: string;
  role: AppRole;
  status: 'active' | 'invited' | 'disabled';
  google_calendar_connected?: boolean;
  google_calendar_email?: string | null;
  google_calendar_id?: string | null;
  google_connected_at?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, workshopName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }

    return data as Profile | null;
  };

  const refreshProfile = async () => {
    if (user) {
      const profileData = await fetchProfile(user.id);
      setProfile(profileData);
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        // Defer profile fetch with setTimeout to avoid deadlock
        if (session?.user) {
          setTimeout(() => {
            fetchProfile(session.user.id).then(setProfile);
          }, 0);
        } else {
          setProfile(null);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchProfile(session.user.id).then((profileData) => {
          setProfile(profileData);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string, workshopName?: string) => {
    const redirectUrl = `${window.location.origin}/`;

    // Sign up with user metadata
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          role: 'ADMIN',
        },
      },
    });

    if (authError) return { error: authError };

    // If we have a user and workshop name, create the workshop and subscription
    if (authData.user && workshopName) {
      // Create workshop
      const { data: workshop, error: workshopError } = await supabase
        .from('workshops')
        .insert({ name: workshopName })
        .select()
        .single();

      if (workshopError) {
        console.error('Error creating workshop:', workshopError);
        return { error: workshopError };
      }

      // Get Starter plan
      const { data: starterPlan } = await supabase
        .from('plans')
        .select('id, max_users')
        .eq('name', 'Starter')
        .single();

      if (starterPlan) {
        // Create subscription
        await supabase.from('subscriptions').insert({
          workshop_id: workshop.id,
          plan_id: starterPlan.id,
          status: 'trial',
          max_users: starterPlan.max_users,
        });
      }

      // Update profile with workshop_id
      await supabase
        .from('profiles')
        .update({ 
          workshop_id: workshop.id,
          role: 'ADMIN',
          full_name: fullName,
        })
        .eq('id', authData.user.id);

      // Create bot_settings and automations_settings for the workshop
      await supabase.from('bot_settings').insert({ workshop_id: workshop.id });
      await supabase.from('automations_settings').insert({ workshop_id: workshop.id });
    }

    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
