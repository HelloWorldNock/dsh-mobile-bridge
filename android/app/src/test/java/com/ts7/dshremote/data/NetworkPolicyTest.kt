package com.ts7.dshremote.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 明文白名单：私网放行、公网必须 https。 */
class NetworkPolicyTest {
    @Test
    fun `private literals may use cleartext`() {
        for (url in listOf(
            "http://192.168.1.5:48123",
            "http://10.0.2.2:48123",
            "http://172.16.0.9:48123",
            "http://172.31.255.1:48123",
            "http://100.100.1.7:48123",
            "http://127.0.0.1:48123",
            "http://169.254.10.20:48123",
            "http://localhost:48123",
            "192.168.1.5:48123"
        )) {
            assertNull("应当放行：$url", NetworkPolicy.check(url))
        }
    }

    @Test
    fun `lan hostnames and single labels may use cleartext`() {
        for (host in listOf("mypc", "desk-pc", "pc.local", "dsh.lan", "box.home.arpa", "nas.internal")) {
            assertTrue("应当放行：$host", NetworkPolicy.cleartextHostAllowed(host))
            assertNull("应当放行：http://$host:48123", NetworkPolicy.check("http://$host:48123"))
        }
    }

    @Test
    fun `public hosts are refused over cleartext`() {
        for (url in listOf(
            "http://8.8.8.8:48123",
            "http://172.32.0.1:48123",
            "http://203.0.113.20:48123",
            "http://dsh.example.com:48123",
            "http://my.pc.example.com"
        )) {
            val reason = NetworkPolicy.check(url)
            assertNotNull("应当拒绝：$url", reason)
            assertTrue("原因要能看懂：$reason", reason!!.contains("只允许局域网或 Tailscale"))
        }
    }

    @Test
    fun `https is always allowed`() {
        assertNull(NetworkPolicy.check("https://dsh.example.com"))
        assertNull(NetworkPolicy.check("https://8.8.8.8:8443"))
    }

    @Test
    fun `ipv6 loopback link local and unique local are allowed`() {
        assertTrue(NetworkPolicy.cleartextHostAllowed("[::1]"))
        assertTrue(NetworkPolicy.cleartextHostAllowed("[fe80::1]"))
        assertTrue(NetworkPolicy.cleartextHostAllowed("[fd00::5]"))
        assertTrue(NetworkPolicy.cleartextHostAllowed("[::ffff:192.168.1.5]"))
        assertFalse(NetworkPolicy.cleartextHostAllowed("[2001:db8::1]"))
    }

    @Test
    fun `odd input is reported instead of crashing`() {
        // 每条都带上下文，失败时能直接看出是哪一种输入被放过了。
        assertNotNull("空串", NetworkPolicy.check(""))
        assertNotNull("纯空格", NetworkPolicy.check("   "))
        assertNotNull("ftp 协议", NetworkPolicy.check("ftp://192.168.1.5"))
        assertNotNull("缺主机", NetworkPolicy.check("http:///path"))
    }

    @Test
    fun `the rejection code is stable for the ui`() {
        assertTrue(NetworkPolicy.BLOCKED_CODE == "network/cleartext-blocked")
    }
}
