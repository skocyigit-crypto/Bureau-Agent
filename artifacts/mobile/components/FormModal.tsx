import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  useInlineSuggest,
  type InlineSuggestFieldType,
} from "@/hooks/useInlineSuggest";

interface FieldConfig {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "email" | "phone" | "multiline" | "select" | "contact";
  options?: { value: string; label: string }[];
  /**
   * For `type: "contact"` — the list of selectable existing contacts. The
   * field value (`values[key]`) holds the picked contact id as a string
   * ("" means none / typing a new contact instead).
   */
  contactOptions?: { id: number; name: string; phone?: string | null }[];
  /** For `type: "contact"` — sibling field key that receives the picked contact's phone. */
  linkedPhoneKey?: string;
  /** For `type: "contact"` — sibling field key that receives the picked contact's name. */
  linkedNameKey?: string;
  required?: boolean;
  /**
   * When true the field is shown for context only and cannot be edited.
   * Use this for values the server treats as immutable so the form never
   * offers a change that would be silently dropped on save.
   */
  readOnly?: boolean;
  /**
   * When set, this field receives debounced AI ghost-text suggestions
   * (respecting the user's inline-suggest preference) using the given
   * inline-suggest field type.
   */
  inlineSuggest?: InlineSuggestFieldType;
  /** Optional key in `values` whose content is forwarded as the suggestion title/subject. */
  inlineSuggestTitleKey?: string;
  /** Optional key in `values` whose content is forwarded as the suggestion contact name. */
  inlineSuggestContactKey?: string;
}

interface FormModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: () => void;
  title: string;
  fields: FieldConfig[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  loading?: boolean;
  submitLabel?: string;
  icon?: keyof typeof Feather.glyphMap;
}

export function FormModal({
  visible,
  onClose,
  onSubmit,
  title,
  fields,
  values,
  onChange,
  loading = false,
  submitLabel = "Enregistrer",
  icon = "save",
}: FormModalProps) {
  const colors = useColors();

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            <View style={{ width: 22 }} />
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {fields.map((field) => (
              <FormField
                key={field.key}
                field={field}
                values={values}
                onChange={onChange}
              />
            ))}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Pressable
              onPress={onClose}
              style={[styles.cancelBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.cancelText, { color: colors.foreground }]}>Annuler</Text>
            </Pressable>
            <Pressable
              onPress={onSubmit}
              disabled={loading}
              style={({ pressed }) => [
                styles.submitBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed || loading ? 0.8 : 1,
                },
              ]}
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <>
                  <Feather name={icon} size={16} color={colors.primaryForeground} />
                  <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
                    {submitLabel}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface FormFieldProps {
  field: FieldConfig;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

function FormField({ field, values, onChange }: FormFieldProps) {
  const colors = useColors();
  const value = values[field.key] || "";
  const [contactQuery, setContactQuery] = useState("");
  const contactOptions = field.contactOptions ?? [];
  const selectedContact = useMemo(
    () => contactOptions.find((c) => String(c.id) === value),
    [contactOptions, value],
  );
  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return contactOptions.slice(0, 6);
    return contactOptions
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [contactOptions, contactQuery]);
  const titleVal = field.inlineSuggestTitleKey ? values[field.inlineSuggestTitleKey] : null;
  const contactVal = field.inlineSuggestContactKey ? values[field.inlineSuggestContactKey] : null;

  const { suggestion, clear, trackAccepted, trackDismissed } = useInlineSuggest({
    fieldType: field.inlineSuggest ?? "note",
    text: value,
    title: titleVal || null,
    contactName: contactVal || null,
    enabled: !!field.inlineSuggest,
  });

  const acceptSuggestion = () => {
    if (!suggestion) return;
    onChange(field.key, value + suggestion);
    trackAccepted(suggestion.length);
    clear();
  };

  const dismissSuggestion = () => {
    if (!suggestion) return;
    trackDismissed(suggestion.length);
    clear();
  };

  if (field.readOnly) {
    const displayValue =
      field.type === "select"
        ? field.options?.find((o) => o.value === value)?.label ?? value
        : value;
    return (
      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {field.label}
        </Text>
        <View
          style={[
            styles.input,
            styles.readOnlyInput,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Text
            style={[styles.readOnlyText, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {displayValue || "—"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        {field.label}
        {field.required ? " *" : ""}
      </Text>
      {field.type === "contact" ? (
        selectedContact ? (
          <View
            style={[
              styles.contactSelected,
              { backgroundColor: colors.muted, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.contactSelectedName, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {selectedContact.name}
              </Text>
              {selectedContact.phone ? (
                <Text
                  style={[styles.contactSelectedPhone, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {selectedContact.phone}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => onChange(field.key, "")}
              hitSlop={8}
              style={styles.contactClearBtn}
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : (
          <>
            <View
              style={[
                styles.contactSearch,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Feather name="search" size={15} color={colors.mutedForeground} />
              <TextInput
                style={[styles.contactSearchInput, { color: colors.foreground }]}
                placeholder={field.placeholder || "Rechercher un contact..."}
                placeholderTextColor={colors.mutedForeground}
                value={contactQuery}
                onChangeText={setContactQuery}
                autoCapitalize="none"
              />
            </View>
            {contactOptions.length === 0 ? (
              <Text style={[styles.contactHint, { color: colors.mutedForeground }]}>
                Aucun contact enregistré — saisissez un nouveau nom ci-dessous.
              </Text>
            ) : filteredContacts.length === 0 ? (
              <Text style={[styles.contactHint, { color: colors.mutedForeground }]}>
                Aucun contact trouvé.
              </Text>
            ) : (
              <View style={styles.contactList}>
                {filteredContacts.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      onChange(field.key, String(c.id));
                      if (field.linkedPhoneKey && c.phone)
                        onChange(field.linkedPhoneKey, c.phone);
                      if (field.linkedNameKey) onChange(field.linkedNameKey, c.name);
                      setContactQuery("");
                    }}
                    style={({ pressed }) => [
                      styles.contactRow,
                      { borderBottomColor: colors.border },
                      pressed && { backgroundColor: colors.muted },
                    ]}
                  >
                    <Text
                      style={[styles.contactRowName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {c.name}
                    </Text>
                    {c.phone ? (
                      <Text
                        style={[styles.contactRowPhone, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {c.phone}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )
      ) : field.type === "select" ? (
        <View style={styles.selectRow}>
          {field.options?.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => onChange(field.key, opt.value)}
              style={[
                styles.selectChip,
                {
                  backgroundColor:
                    value === opt.value ? colors.primary : colors.muted,
                  borderColor:
                    value === opt.value ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.selectText,
                  {
                    color:
                      value === opt.value
                        ? colors.primaryForeground
                        : colors.foreground,
                  },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                color: colors.foreground,
              },
              field.type === "multiline" && styles.multilineInput,
            ]}
            placeholder={field.placeholder || field.label}
            placeholderTextColor={colors.mutedForeground}
            value={value}
            onChangeText={(v) => onChange(field.key, v)}
            keyboardType={
              field.type === "email"
                ? "email-address"
                : field.type === "phone"
                ? "phone-pad"
                : "default"
            }
            autoCapitalize={field.type === "email" ? "none" : "sentences"}
            multiline={field.type === "multiline"}
            numberOfLines={field.type === "multiline" ? 4 : 1}
            textAlignVertical={field.type === "multiline" ? "top" : "center"}
          />
          {field.inlineSuggest && suggestion ? (
            <View style={[styles.suggestionRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
              <Feather name="zap" size={12} color={colors.primary} />
              <Text
                style={[styles.suggestionText, { color: colors.mutedForeground }]}
                numberOfLines={3}
              >
                {suggestion}
              </Text>
              <Pressable
                onPress={acceptSuggestion}
                style={[styles.suggestionBtn, { borderColor: colors.primary }]}
                hitSlop={6}
              >
                <Text style={[styles.suggestionBtnText, { color: colors.primary }]}>
                  Ajouter
                </Text>
              </Pressable>
              <Pressable onPress={dismissSuggestion} hitSlop={8} style={styles.suggestionDismiss}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  container: {
    maxHeight: "92%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  body: {
    maxHeight: 500,
  },
  bodyContent: {
    padding: 20,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  multilineInput: {
    height: 100,
    paddingTop: 14,
  },
  readOnlyInput: {
    justifyContent: "center",
    opacity: 0.7,
  },
  readOnlyText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 10,
  },
  suggestionText: {
    flex: 1,
    fontSize: 13,
    fontStyle: "italic",
    fontFamily: "Inter_400Regular",
  },
  suggestionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  suggestionBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  suggestionDismiss: {
    padding: 2,
  },
  contactSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
  },
  contactSearchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  contactHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
  },
  contactList: {
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  contactRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  contactRowName: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  contactRowPhone: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  contactSelected: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  contactSelectedName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  contactSelectedPhone: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  contactClearBtn: {
    padding: 4,
  },
  selectRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  selectChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  selectText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  submitBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  submitText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
