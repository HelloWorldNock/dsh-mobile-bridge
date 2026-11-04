package com.ts7.dshremote.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ts7.dshremote.DeepLinks
import com.ts7.dshremote.data.BridgeRepository
import com.ts7.dshremote.ui.screens.ApprovalsScreen
import com.ts7.dshremote.ui.screens.ConnectScreen
import com.ts7.dshremote.ui.screens.NewTaskScreen
import com.ts7.dshremote.ui.screens.SessionScreen
import com.ts7.dshremote.ui.screens.SessionsScreen
import com.ts7.dshremote.ui.screens.SettingsScreen
import kotlinx.coroutines.launch

@Composable
fun AppRoot(repository: BridgeRepository) {
    val state by repository.state.collectAsState()
    val deepLink by DeepLinks.session.collectAsState()
    val nav = rememberNavController()
    val scope = rememberCoroutineScope()

    fun selectHost(id: String) {
        repository.selectHost(id)
        scope.launch {
            repository.refreshSessions(id)
            repository.refreshPending(id)
        }
    }

    LaunchedEffect(Unit) { repository.start() }

    LaunchedEffect(deepLink) {
        val target = deepLink ?: return@LaunchedEffect
        DeepLinks.session.value = null
        target.hostId?.let { repository.selectHost(it) }
        repository.openSession(target.sessionId)
        nav.navigate("session/${target.sessionId}") { launchSingleTop = true }
    }

    NavHost(navController = nav, startDestination = "sessions") {
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
                onSettings = { nav.navigate("settings") },
                onConnect = { nav.navigate("connect") },
                onSelectHost = { id -> selectHost(id) }
            )
        }
        composable("connect") {
            ConnectScreen(
                repository = repository,
                hosts = state.hosts,
                onConnected = {
                    nav.navigate("sessions") {
                        popUpTo("sessions") { inclusive = true }
                    }
                },
                onBack = { nav.popBackStack() }
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
                tailscale = repository.tailscale,
                onBack = { nav.popBackStack() },
                onRetry = { id -> repository.retry(id) },
                onSelectHost = { id -> selectHost(id) },
                onPairNew = { nav.navigate("connect") },
                onForgetHost = { id -> repository.forget(id) },
                onAddEndpoint = { id, url -> repository.addEndpoint(id, url) },
                onApprovals = { nav.navigate("approvals") },
                onLinkGroup = { repository.linkGroup() }
            )
        }
    }
}
