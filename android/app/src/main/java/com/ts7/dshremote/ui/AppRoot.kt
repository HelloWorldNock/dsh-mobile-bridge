package com.ts7.dshremote.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ts7.dshremote.DeepLinks
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.data.ConnectionState
import com.ts7.dshremote.ui.screens.ApprovalsScreen
import com.ts7.dshremote.ui.screens.ConnectScreen
import com.ts7.dshremote.ui.screens.NewTaskScreen
import com.ts7.dshremote.ui.screens.SessionScreen
import com.ts7.dshremote.ui.screens.SessionsScreen
import com.ts7.dshremote.ui.screens.SettingsScreen

@Composable
fun AppRoot(repository: BridgeRepository) {
    val state by repository.state.collectAsState()
    val deepLink by DeepLinks.session.collectAsState()
    val nav = rememberNavController()
    val start = remember { if (repository.hasSavedPair) "sessions" else "connect" }

    LaunchedEffect(Unit) { repository.start() }

    LaunchedEffect(deepLink) {
        val id = deepLink ?: return@LaunchedEffect
        DeepLinks.session.value = null
        repository.openSession(id)
        nav.navigate("session/$id") { launchSingleTop = true }
    }

    NavHost(navController = nav, startDestination = start) {
        composable("connect") {
            ConnectScreen(repository = repository, connection = state.connection)
            LaunchedEffect(state.connection) {
                if (state.connection == ConnectionState.Connected) {
                    nav.navigate("sessions") {
                        popUpTo("connect") { inclusive = true }
                    }
                }
            }
        }
        composable("sessions") {
            SessionsScreen(
                repository = repository,
                state = state,
                onOpen = { id ->
                    repository.openSession(id)
                    nav.navigate("session/$id")
                },
                onNew = { nav.navigate("new") },
                onApprovals = { nav.navigate("approvals") },
                onSettings = { nav.navigate("settings") }
            )
        }
        composable(
            "session/{id}",
            arguments = listOf(navArgument("id") { type = NavType.StringType })
        ) { entry ->
            val id = entry.arguments?.getString("id") ?: return@composable
            LaunchedEffect(id) { repository.openSession(id) }
            SessionScreen(
                repository = repository,
                state = state,
                onBack = {
                    repository.closeSession()
                    nav.popBackStack()
                },
                onApprovals = { nav.navigate("approvals") }
            )
        }
        composable("approvals") {
            ApprovalsScreen(
                repository = repository,
                state = state,
                onBack = { nav.popBackStack() }
            )
        }
        composable("new") {
            NewTaskScreen(
                repository = repository,
                state = state,
                onBack = { nav.popBackStack() },
                onCreated = { id ->
                    repository.openSession(id)
                    nav.navigate("session/$id") {
                        popUpTo("sessions")
                    }
                }
            )
        }
        composable("settings") {
            SettingsScreen(
                state = state,
                onBack = { nav.popBackStack() },
                onRetry = { repository.retry() },
                onForget = {
                    repository.forget()
                    nav.navigate("connect") {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onApprovals = { nav.navigate("approvals") }
            )
        }
    }
}
