// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract EuroStablecoin is ERC20, Ownable, Pausable {
    uint256 public constant LOCK_DURATION = 7 days;
    uint256 public constant MIN_REBASE_INTERVAL = 24 hours;

    uint256 internal _lastRebaseTime;
    uint256 internal _rebaseMultiplier = 1e18;

    mapping(address => uint256) internal _lockedRealBalances;
    mapping(address => uint256) internal _lockEndTimes;
    mapping(address => uint256) internal _lastRebaseSnapshot;
    mapping(address => uint256) internal _realBalances;
    mapping(address => bool) internal _isHolder;
    address[] internal _holders;

    event RebaseApplied(address indexed caller, uint256 newMultiplier, int256 supplyDelta);
    event LockupIssued(address indexed account, uint256 realAmount, uint256 unlockTime);
    event LockupReleased(address indexed account, uint256 realAmount);

    error InvalidRebaseTime();
    error InsufficientBalance();
    error NothingToClaim();
    error ZeroAddress();

    constructor(address initialOwner) 
        ERC20("Euro Stablecoin", "EUROC") 
        Ownable(initialOwner) 
    {
        _lastRebaseTime = block.timestamp;
    }

    function globalMultiplier() external view returns (uint256) {
        return _rebaseMultiplier;
    }

    function lastRebaseTime() external view returns (uint256) {
        return _lastRebaseTime;
    }

    function baseBalanceOf(address account) external view returns (uint256) {
        return _getEffectiveBalance(account);
    }

    function lockedBalanceOf(address account) external view returns (uint256) {
        return _lockedRealBalances[account];
    }

    function lockEndTimeOf(address account) external view returns (uint256) {
        return _lockEndTimes[account];
    }

    function balanceOf(address account) public view override returns (uint256) {
        uint256 effective = _getEffectiveBalance(account);
        uint256 locked = _getClaimableLocked(account);
        return effective + locked;
    }

    function totalSupply() public view override returns (uint256) {
        return ERC20.totalSupply();
    }

    function _getEffectiveBalance(address account) internal view returns (uint256) {
        uint256 snapshot = _lastRebaseSnapshot[account];
        if (snapshot == 0) return 0;
        return (_realBalances[account] * _rebaseMultiplier) / snapshot;
    }

    function _getClaimableLocked(address account) internal view returns (uint256) {
        if (block.timestamp >= _lockEndTimes[account]) {
            return _lockedRealBalances[account];
        }
        return 0;
    }

    function _syncAccount(address account) internal {
        uint256 snapshot = _lastRebaseSnapshot[account];
        if (snapshot != _rebaseMultiplier && snapshot != 0) {
            uint256 effective = (_realBalances[account] * _rebaseMultiplier) / snapshot;
            
            uint256 locked = _lockedRealBalances[account];
            if (locked > 0) {
                uint256 lockedEffective = (locked * _rebaseMultiplier) / snapshot;
                effective += lockedEffective;
                _lockedRealBalances[account] = 0;
                _lockEndTimes[account] = 0;
            }
            
            _realBalances[account] = effective;
            _lastRebaseSnapshot[account] = _rebaseMultiplier;
        }
    }
    
    function _addLockedToBalance(address account) internal {
        uint256 locked = _lockedRealBalances[account];
        if (locked > 0) {
            _realBalances[account] += locked;
            _lockedRealBalances[account] = 0;
        }
    }

    function _checkAvailableBalance(address account, uint256 amount) internal view {
        uint256 effective = _getEffectiveBalance(account);
        uint256 locked = _getClaimableLocked(account);
        
        if (effective - locked < amount) {
            revert InsufficientBalance();
        }
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (paused() && amount > 0) {
            revert Pausable.EnforcedPause();
        }
        
        if (from != address(0)) {
            _syncAccount(from);
            _checkAvailableBalance(from, amount);
            _realBalances[from] -= amount;
        }
        
        if (to != address(0)) {
            _syncAccount(to);
            _realBalances[to] += amount;
            _lastRebaseSnapshot[to] = _rebaseMultiplier;
            if (!_isHolder[to]) {
                _isHolder[to] = true;
                _holders.push(to);
            }
        }
        
        super._update(from, to, amount);
    }

    function mintBase(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        _mint(to, amount);
    }

    function burnBase(address from, uint256 amount) external onlyOwner {
        if (from == address(0)) revert ZeroAddress();
        _burn(from, amount);
    }

    function _distributeLockup(uint256 amount) internal {
        uint256 total = ERC20.totalSupply();
        if (total == 0) return;
        
        uint256 lockEnd = block.timestamp + LOCK_DURATION;
        
        for (uint256 i = 0; i < _holders.length; i++) {
            address holder = _holders[i];
            uint256 holderBalance = balanceOf(holder);
            
            if (holderBalance > 0) {
                uint256 share = (amount * holderBalance) / total;
                if (share > 0) {
                    _lockedRealBalances[holder] += share;
                    _lockEndTimes[holder] = lockEnd;
                    emit LockupIssued(holder, share, lockEnd);
                }
            }
        }
    }

    function rebase(int256 supplyDelta) external onlyOwner whenNotPaused {
        if (block.timestamp < _lastRebaseTime + MIN_REBASE_INTERVAL) {
            revert InvalidRebaseTime();
        }
        
        uint256 total = ERC20.totalSupply();
        
        if (supplyDelta > 0) {
            uint256 newTotal = total + uint256(supplyDelta);
            uint256 oldMultiplier = _rebaseMultiplier;
            uint256 newMultiplier = (newTotal * 1e18) / total;
            
            _mint(address(this), uint256(supplyDelta));
            
            uint256 lockEnd = block.timestamp + LOCK_DURATION;
            for (uint256 i = 0; i < _holders.length; i++) {
                address holder = _holders[i];
                uint256 snapshot = _lastRebaseSnapshot[holder];
                if (snapshot == 0) continue;
                
                uint256 holderOldBalance = (_realBalances[holder] * oldMultiplier) / snapshot;
                uint256 share = (uint256(supplyDelta) * holderOldBalance) / total;
                
                if (share > 0) {
                    _lockedRealBalances[holder] += share;
                    _lockEndTimes[holder] = lockEnd;
                    emit LockupIssued(holder, share, lockEnd);
                }
            }
            
            _rebaseMultiplier = newMultiplier;
        } else if (supplyDelta < 0) {
            uint256 absDelta = uint256(-supplyDelta);
            uint256 newTotal = total - absDelta;
            require(newTotal > 0, "EuroStablecoin: total supply cannot be zero");
            _rebaseMultiplier = (newTotal * 1e18) / total;
        }
        
        _lastRebaseTime = block.timestamp;
        
        emit RebaseApplied(msg.sender, _rebaseMultiplier, supplyDelta);
    }

    function rebaseWithCustomLockup(int256 supplyDelta, uint256 customLockDuration) external onlyOwner whenNotPaused {
        if (customLockDuration > 365 days) revert("EuroStablecoin: lock duration too long");
        
        if (block.timestamp < _lastRebaseTime + MIN_REBASE_INTERVAL) {
            revert InvalidRebaseTime();
        }
        
        uint256 total = ERC20.totalSupply();
        
        if (supplyDelta > 0) {
            uint256 newTotal = total + uint256(supplyDelta);
            uint256 oldMultiplier = _rebaseMultiplier;
            uint256 newMultiplier = (newTotal * 1e18) / total;
            
            _mint(address(this), uint256(supplyDelta));
            
            uint256 lockEnd = block.timestamp + customLockDuration;
            for (uint256 i = 0; i < _holders.length; i++) {
                address holder = _holders[i];
                uint256 snapshot = _lastRebaseSnapshot[holder];
                if (snapshot == 0) continue;
                
                uint256 holderOldBalance = (_realBalances[holder] * oldMultiplier) / snapshot;
                uint256 share = (uint256(supplyDelta) * holderOldBalance) / total;
                
                if (share > 0) {
                    _lockedRealBalances[holder] += share;
                    uint256 newLockEnd = block.timestamp + customLockDuration;
                    if (newLockEnd > _lockEndTimes[holder]) {
                        _lockEndTimes[holder] = newLockEnd;
                    }
                    emit LockupIssued(holder, share, newLockEnd);
                }
            }
            
            _rebaseMultiplier = newMultiplier;
        } else if (supplyDelta < 0) {
            uint256 absDelta = uint256(-supplyDelta);
            uint256 newTotal = total - absDelta;
            require(newTotal > 0, "EuroStablecoin: total supply cannot be zero");
            _rebaseMultiplier = (newTotal * 1e18) / total;
        }
        
        _lastRebaseTime = block.timestamp;
        
        emit RebaseApplied(msg.sender, _rebaseMultiplier, supplyDelta);
    }

    function claimUnlocked() external whenNotPaused {
        address account = msg.sender;
        
        if (_lockedRealBalances[account] == 0) {
            _syncAccount(account);
            if (_lockedRealBalances[account] == 0) {
                revert NothingToClaim();
            }
        }
        
        if (block.timestamp < _lockEndTimes[account]) {
            revert NothingToClaim();
        }
        
        uint256 amount = _lockedRealBalances[account];
        
        _syncAccount(account);
        
        uint256 amountToAdd = _lockedRealBalances[account];
        _addLockedToBalance(account);
        _lockEndTimes[account] = 0;
        
        emit LockupReleased(account, amountToAdd);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getAccountState(address account) external view returns (
        uint256 effectiveBalance, 
        uint256 lockedRealBalance, 
        uint256 lockEndTime, 
        uint256 totalBalance
    ) {
        effectiveBalance = _getEffectiveBalance(account);
        lockedRealBalance = _lockedRealBalances[account];
        lockEndTime = _lockEndTimes[account];
        totalBalance = balanceOf(account);
    }

    function holdersCount() external view returns (uint256) {
        return _holders.length;
    }
}
