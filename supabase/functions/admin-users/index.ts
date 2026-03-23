import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the caller using anon key client
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: roles } = await callerClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id);
    const isAdmin = roles?.some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get caller's household
    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("household_id")
      .eq("user_id", caller.id)
      .single();
    if (!callerProfile) {
      return new Response(
        JSON.stringify({ error: "No household found" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { action } = body;

    if (action === "create-user") {
      const { email, password, display_name, avatar_initial } = body;

      // Create auth user
      const { data: newUser, error: createError } =
        await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create profile
      await adminClient.from("profiles").insert({
        user_id: newUser.user.id,
        household_id: callerProfile.household_id,
        display_name: display_name || email,
        avatar_initial: avatar_initial || display_name?.charAt(0) || "U",
      });

      // Assign member role
      await adminClient.from("user_roles").insert({
        user_id: newUser.user.id,
        role: "member",
      });

      return new Response(
        JSON.stringify({ success: true, user_id: newUser.user.id }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "update-user") {
      const { user_id, email, password, display_name, avatar_initial } = body;

      // Update auth user if email or password changed
      const updates: Record<string, string> = {};
      if (email) updates.email = email;
      if (password) updates.password = password;

      if (Object.keys(updates).length > 0) {
        const { error: updateError } =
          await adminClient.auth.admin.updateUserById(user_id, updates);
        if (updateError) {
          return new Response(
            JSON.stringify({ error: updateError.message }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }

      // Update profile
      const profileUpdates: Record<string, string> = {};
      if (display_name) profileUpdates.display_name = display_name;
      if (avatar_initial) profileUpdates.avatar_initial = avatar_initial;

      if (Object.keys(profileUpdates).length > 0) {
        await adminClient
          .from("profiles")
          .update(profileUpdates)
          .eq("user_id", user_id);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete-user") {
      const { user_id } = body;

      // Cannot delete yourself
      if (user_id === caller.id) {
        return new Response(
          JSON.stringify({ error: "Cannot delete your own account" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { error: deleteError } =
        await adminClient.auth.admin.deleteUser(user_id);
      if (deleteError) {
        return new Response(
          JSON.stringify({ error: deleteError.message }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list-users") {
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("*")
        .eq("household_id", callerProfile.household_id);

      // Get auth user details for last sign in
      const enriched = await Promise.all(
        (profiles || []).map(async (p: Record<string, unknown>) => {
          const { data } = await adminClient.auth.admin.getUserById(
            p.user_id as string
          );
          return {
            ...p,
            email: data?.user?.email,
            last_sign_in_at: data?.user?.last_sign_in_at,
          };
        })
      );

      return new Response(JSON.stringify({ users: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
