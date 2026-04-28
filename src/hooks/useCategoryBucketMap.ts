import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { suggestBucket } from "@/lib/cfpBuckets";

export interface CategoryBucketMapping {
  category_slug: string;
  bucket_key: string;
  category_kind: "variable" | "fixed";
}

/**
 * Loads the household's category → CFP bucket map and provides helpers to
 * upsert / clear mappings. The map is small (one row per category) so we
 * keep the whole thing in memory.
 */
export function useCategoryBucketMap() {
  const { profile } = useAuth();
  const householdId = profile?.household_id;
  const [map, setMap] = useState<Record<string, CategoryBucketMapping>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!householdId) {
      setMap({});
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("category_bucket_map")
      .select("category_slug,bucket_key,category_kind")
      .eq("household_id", householdId);
    if (error) {
      console.error("category_bucket_map load error", error);
      setLoading(false);
      return;
    }
    const next: Record<string, CategoryBucketMapping> = {};
    for (const row of data || []) {
      next[row.category_slug] = {
        category_slug: row.category_slug,
        bucket_key: row.bucket_key,
        category_kind: (row.category_kind as "variable" | "fixed") || "variable",
      };
    }
    setMap(next);
    setLoading(false);
  }, [householdId]);

  useEffect(() => { void load(); }, [load]);

  const setMapping = useCallback(async (
    categorySlug: string,
    bucketKey: string,
    kind: "variable" | "fixed",
  ) => {
    if (!householdId) return;
    setMap(prev => ({
      ...prev,
      [categorySlug]: { category_slug: categorySlug, bucket_key: bucketKey, category_kind: kind },
    }));
    const { error } = await supabase.from("category_bucket_map").upsert({
      household_id: householdId,
      category_slug: categorySlug,
      bucket_key: bucketKey,
      category_kind: kind,
    }, { onConflict: "household_id,category_slug" });
    if (error) console.error("category_bucket_map upsert error", error);
  }, [householdId]);

  const clearMapping = useCallback(async (categorySlug: string) => {
    if (!householdId) return;
    setMap(prev => {
      const next = { ...prev };
      delete next[categorySlug];
      return next;
    });
    await supabase.from("category_bucket_map")
      .delete()
      .eq("household_id", householdId)
      .eq("category_slug", categorySlug);
  }, [householdId]);

  /**
   * Return the bucket for a category, falling back to the structural
   * shortcut for `savings`/`tithe`/`giving` groups so users with intentional
   * schema decisions don't have to map those by hand.
   */
  const resolveBucket = useCallback((categorySlug: string, name?: string, group?: string): string | null => {
    const explicit = map[categorySlug]?.bucket_key;
    if (explicit) return explicit;
    const g = (group || "").toLowerCase();
    if (g === "savings" || g === "saving") return "saving";
    if (g === "tithe" || g === "giving") return "giving";
    return null;
  }, [map]);

  /**
   * Returns the keyword-based suggestion (used as the smart default in the
   * mapping UI). Independent of any saved mapping.
   */
  const suggest = useCallback((name: string, group?: string): string | null => {
    return suggestBucket(name, group);
  }, []);

  return { map, loading, setMapping, clearMapping, resolveBucket, suggest, reload: load };
}
