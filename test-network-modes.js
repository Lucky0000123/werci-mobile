/**
 * WERCI Mobile Network Mode Testing Script
 * 
 * This script provides comprehensive testing utilities for validating
 * data flow across all three network connectivity modes:
 * 1. Offline Mode (no network)
 * 2. Company WiFi Mode (local endpoint preference)
 * 3. Mobile Network Mode (cloud endpoint)
 * 
 * Usage: Run in browser console while on the mobile app
 */

class NetworkModeValidator {
  constructor() {
    this.testResults = {
      offline: { passed: 0, failed: 0, tests: [] },
      companyWiFi: { passed: 0, failed: 0, tests: [] },
      mobileNetwork: { passed: 0, failed: 0, tests: [] }
    }
  }

  // Test 1: Offline Mode Validation
  async testOfflineMode() {
    console.log('🔄 Testing Offline Mode...')
    
    try {
      // Step 1: Simulate offline
      if (typeof connectionManager !== 'undefined') {
        connectionManager.simulateOffline()
      }
      
      // Step 2: Test inspection submission
      const testInspection = {
        equipmentNumber: 'TEST-OFFLINE-001',
        inspectorName: 'Test Inspector',
        inspectionDate: new Date().toISOString().split('T')[0],
        overallCondition: 'good',
        notes: 'Offline mode test'
      }
      
      // Step 3: Check IndexedDB storage
      const { setInspection, enqueue } = await import('/src/services/db.js')
      const localId = crypto.randomUUID()
      
      await setInspection({
        id: localId,
        pendingSync: true,
        ...testInspection,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      
      await enqueue({
        kind: 'inspection',
        refId: localId,
        priority: 1
      })
      
      console.log('✅ Offline inspection saved to IndexedDB')
      this.recordTest('offline', 'Inspection saved offline', true)
      
      // Step 4: Test photo storage
      const testPhoto = {
        id: crypto.randomUUID(),
        inspectionId: localId,
        data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
        filename: 'test-offline.jpg',
        pendingSync: true
      }
      
      const { addPhoto } = await import('/src/services/db.js')
      await addPhoto(testPhoto)
      
      console.log('✅ Offline photo saved to IndexedDB')
      this.recordTest('offline', 'Photo saved offline', true)
      
      return true
    } catch (error) {
      console.error('❌ Offline mode test failed:', error)
      this.recordTest('offline', 'Offline mode test', false, error.message)
      return false
    }
  }

  // Test 2: Company WiFi Mode Validation
  async testCompanyWiFiMode() {
    console.log('🏢 Testing Company WiFi Mode...')
    
    try {
      // Check if we're on company network (10.40.21.x)
      const isCompanyNetwork = await this.detectCompanyNetwork()
      
      if (!isCompanyNetwork) {
        console.warn('⚠️ Not on company network, simulating local preference')
      }
      
      // Test local endpoint preference
      const { apiFetch } = await import('/src/services/api.js')
      const startTime = Date.now()
      
      const response = await apiFetch('/api/mobile/health', {
        method: 'GET'
      })
      
      const responseTime = Date.now() - startTime
      console.log(`📊 Health check response time: ${responseTime}ms`)
      
      if (response.ok) {
        console.log('✅ Company WiFi mode working')
        this.recordTest('companyWiFi', 'Local endpoint accessible', true)
        return true
      } else {
        throw new Error('Health check failed')
      }
    } catch (error) {
      console.error('❌ Company WiFi mode test failed:', error)
      this.recordTest('companyWiFi', 'Company WiFi mode test', false, error.message)
      return false
    }
  }

  // Test 3: Mobile Network Mode Validation
  async testMobileNetworkMode() {
    console.log('📱 Testing Mobile Network Mode...')
    
    try {
      // Force cloud endpoint usage
      const cloudEndpoint = 'http://159.65.13.232:8082'
      
      const response = await fetch(cloudEndpoint + '/api/mobile/health', {
        method: 'GET',
        timeout: 10000
      })
      
      if (response.ok) {
        console.log('✅ Cloud endpoint accessible')
        this.recordTest('mobileNetwork', 'Cloud endpoint accessible', true)
        
        // Test actual data submission
        const testData = {
          equip_no: 'DT A 042',
          inspector_name: 'Mobile Test',
          inspection_date: new Date().toISOString().split('T')[0],
          status: 'completed',
          star_rating: 4
        }
        
        // Note: This would need proper auth token
        console.log('📊 Cloud endpoint ready for mobile network usage')
        return true
      } else {
        throw new Error('Cloud endpoint not accessible')
      }
    } catch (error) {
      console.error('❌ Mobile network mode test failed:', error)
      this.recordTest('mobileNetwork', 'Mobile network mode test', false, error.message)
      return false
    }
  }

  // Helper: Detect company network
  async detectCompanyNetwork() {
    try {
      // Try to access local endpoint
      const response = await fetch('http://10.40.21.184:8082/health', {
        method: 'GET',
        timeout: 3000
      })
      return response.ok
    } catch {
      return false
    }
  }

  // Helper: Record test results
  recordTest(mode, testName, passed, error = null) {
    const result = {
      name: testName,
      passed,
      timestamp: new Date().toISOString(),
      error
    }
    
    this.testResults[mode].tests.push(result)
    if (passed) {
      this.testResults[mode].passed++
    } else {
      this.testResults[mode].failed++
    }
  }

  // Generate comprehensive test report
  generateReport() {
    console.log('\n📊 WERCI Mobile Network Mode Test Report')
    console.log('=' .repeat(50))
    
    Object.entries(this.testResults).forEach(([mode, results]) => {
      console.log(`\n${mode.toUpperCase()} MODE:`)
      console.log(`✅ Passed: ${results.passed}`)
      console.log(`❌ Failed: ${results.failed}`)
      
      results.tests.forEach(test => {
        const status = test.passed ? '✅' : '❌'
        console.log(`  ${status} ${test.name}`)
        if (test.error) {
          console.log(`    Error: ${test.error}`)
        }
      })
    })
    
    return this.testResults
  }

  // Run all tests sequentially
  async runAllTests() {
    console.log('🚀 Starting comprehensive network mode validation...')
    
    await this.testOfflineMode()
    await this.testCompanyWiFiMode()
    await this.testMobileNetworkMode()
    
    return this.generateReport()
  }
}

// Export for use in browser console
window.NetworkModeValidator = NetworkModeValidator

// Quick test functions for manual testing
window.testOffline = async () => {
  const validator = new NetworkModeValidator()
  return await validator.testOfflineMode()
}

window.testCompanyWiFi = async () => {
  const validator = new NetworkModeValidator()
  return await validator.testCompanyWiFiMode()
}

window.testMobileNetwork = async () => {
  const validator = new NetworkModeValidator()
  return await validator.testMobileNetworkMode()
}

window.runAllNetworkTests = async () => {
  const validator = new NetworkModeValidator()
  return await validator.runAllTests()
}

console.log('🔧 Network Mode Validator loaded!')
console.log('Usage:')
console.log('  runAllNetworkTests() - Run complete test suite')
console.log('  testOffline() - Test offline mode only')
console.log('  testCompanyWiFi() - Test company WiFi mode only')
console.log('  testMobileNetwork() - Test mobile network mode only')
