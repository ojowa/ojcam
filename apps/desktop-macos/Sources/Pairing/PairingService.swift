//
//  PairingService.swift
//  Ojowacam Desktop
//

import Foundation

class PairingService {
    private var pairingCode: String?
    private var codeExpiration: Date?
    
    func generatePairingCode() -> String {
        let code = String(format: "%06d", Int.random(in: 100000...999999))
        pairingCode = code
        codeExpiration = Date().addingTimeInterval(600) // 10 minutes
        return code
    }
    
    func validatePairingCode(_ code: String) -> Bool {
        guard let storedCode = pairingCode,
              let expiration = codeExpiration,
              code == storedCode,
              Date() < expiration else {
            return false
        }
        return true
    }
    
    func invalidateCode() {
        pairingCode = nil
        codeExpiration = nil
    }
}
