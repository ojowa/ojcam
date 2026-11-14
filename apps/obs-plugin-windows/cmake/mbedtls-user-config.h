/* MbedTLS user configuration appended by MBEDTLS_USER_CONFIG_FILE.
 *
 * libdatachannel's DtlsSrtpTransport requires the DTLS-SRTP extension
 * (mbedtls/ssl.h APIs mbedtls_ssl_conf_dtls_srtp_protection_profiles and
 * mbedtls_ssl_get_dtls_srtp_negotiation_result), which is not compiled by
 * default in MbedTLS 3.6. Defining MBEDTLS_SSL_DTLS_SRTP enables it.
 */
#ifndef MBEDTLS_USER_CONFIG_FILE_CUSTOM
#define MBEDTLS_USER_CONFIG_FILE_CUSTOM

#define MBEDTLS_SSL_DTLS_SRTP

#endif /* MBEDTLS_USER_CONFIG_FILE_CUSTOM */
