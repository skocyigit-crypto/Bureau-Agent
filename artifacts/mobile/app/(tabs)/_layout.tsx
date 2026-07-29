import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Redirect, Tabs } from "expo-router";
import { Badge, Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useUnreadBadges } from "@/contexts/UnreadBadgesContext";
import { useCalendarEvents } from "@/contexts/CalendarEventsContext";
import { useColors } from "@/hooks/useColors";
import { useTranslation } from "@/lib/i18n";

function formatBadge(n: number): string | undefined {
  if (!n || n <= 0) return undefined;
  return n > 99 ? "99+" : String(n);
}

function NativeTabLayout() {
  const { counts } = useUnreadBadges();
  const { badgeCount } = useCalendarEvents();
  const { t } = useTranslation();
  const tasksBadge = formatBadge(counts.task);
  const moreBadge = formatBadge(counts.message);
  const calendarBadge = formatBadge(badgeCount);

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>{t("tabs.home")}</Label>
        {calendarBadge ? <Badge>{calendarBadge}</Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calls">
        <Icon sf={{ default: "phone", selected: "phone.fill" }} />
        <Label>{t("tabs.calls")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="contacts">
        <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <Label>{t("tabs.contacts")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks">
        <Icon sf={{ default: "checkmark.square", selected: "checkmark.square.fill" }} />
        <Label>{t("tabs.tasks")}</Label>
        {tasksBadge ? <Badge>{tasksBadge}</Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <Icon sf={{ default: "ellipsis.circle", selected: "ellipsis.circle.fill" }} />
        <Label>{t("tabs.more")}</Label>
        {moreBadge ? <Badge>{moreBadge}</Badge> : null}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const { counts } = useUnreadBadges();
  const { badgeCount } = useCalendarEvents();
  const tasksBadge = formatBadge(counts.task);
  const moreBadge = formatBadge(counts.message);
  const calendarBadge = formatBadge(badgeCount);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.card,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.card },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          tabBarBadge: calendarBadge,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={24} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: t("tabs.calls"),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="phone" tintColor={color} size={24} />
            ) : (
              <Feather name="phone" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: t("tabs.contacts"),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={24} />
            ) : (
              <Feather name="users" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: t("tabs.tasks"),
          tabBarBadge: tasksBadge,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="checkmark.square" tintColor={color} size={24} />
            ) : (
              <Feather name="check-square" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t("tabs.more"),
          tabBarBadge: moreBadge,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="ellipsis.circle" tintColor={color} size={24} />
            ) : (
              <Feather name="more-horizontal" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
