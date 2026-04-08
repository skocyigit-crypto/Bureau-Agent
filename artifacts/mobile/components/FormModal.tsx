import { Feather } from "@expo/vector-icons";
import React from "react";
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

interface FieldConfig {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "email" | "phone" | "multiline" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
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
              <View key={field.key} style={styles.fieldGroup}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Text>
                {field.type === "select" ? (
                  <View style={styles.selectRow}>
                    {field.options?.map((opt) => (
                      <Pressable
                        key={opt.value}
                        onPress={() => onChange(field.key, opt.value)}
                        style={[
                          styles.selectChip,
                          {
                            backgroundColor:
                              values[field.key] === opt.value
                                ? colors.primary
                                : colors.muted,
                            borderColor:
                              values[field.key] === opt.value
                                ? colors.primary
                                : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.selectText,
                            {
                              color:
                                values[field.key] === opt.value
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
                    value={values[field.key] || ""}
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
                )}
              </View>
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
