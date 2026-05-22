// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract NBTToken {
    string private _name;
    string private _symbol;
    uint8 private constant _DECIMALS = 18;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    uint256 public constant FEE_BASE = 10_000;
    uint256 public immutable buyFee;
    uint256 public immutable sellFee;
    address public immutable feeReceiver;
    mapping(address => bool) public isPair;
    mapping(address => bool) public isExcludedFromFee;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event PairSet(address indexed pair);
    event ExcludedFromFeeSet(address indexed account);
    event FeeCollected(address indexed from, address indexed to, uint256 amount, bool isSell);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        address feeReceiver_,
        uint256 buyFee_,
        uint256 sellFee_,
        address[] memory initialPairs,
        address[] memory initialExcludedFromFee
    ) {
        require(feeReceiver_ != address(0), "Invalid address");
        require(buyFee_ <= 1_000 && sellFee_ <= 1_000, "Fee too high");

        _name = name_;
        _symbol = symbol_;
        feeReceiver = feeReceiver_;
        buyFee = buyFee_;
        sellFee = sellFee_;

        _setExcluded(msg.sender);
        _setExcluded(feeReceiver_);

        for (uint256 i = 0; i < initialExcludedFromFee.length; i++) {
            _setExcluded(initialExcludedFromFee[i]);
        }

        for (uint256 i = 0; i < initialPairs.length; i++) {
            require(initialPairs[i] != address(0), "Invalid address");
            isPair[initialPairs[i]] = true;
            emit PairSet(initialPairs[i]);
        }

        _mint(msg.sender, initialSupply_);
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function decimals() external pure returns (uint8) {
        return _DECIMALS;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address tokenOwner, address spender) external view returns (uint256) {
        return _allowances[tokenOwner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "ERC20: insufficient allowance");
        unchecked {
            _approve(from, msg.sender, currentAllowance - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function calculateSellAmount(uint256 amount) external view returns (uint256 feeAmount, uint256 receiveAmount) {
        feeAmount = amount * sellFee / FEE_BASE;
        receiveAmount = amount - feeAmount;
    }

    function calculateBuyAmount(uint256 amount) external view returns (uint256 feeAmount, uint256 receiveAmount) {
        feeAmount = amount * buyFee / FEE_BASE;
        receiveAmount = amount - feeAmount;
    }

    function getFeeConfig() external view returns (uint256 _buyFee, uint256 _sellFee, address _feeReceiver) {
        return (buyFee, sellFee, feeReceiver);
    }

    function _setExcluded(address account) internal {
        require(account != address(0), "Invalid address");
        if (!isExcludedFromFee[account]) {
            isExcludedFromFee[account] = true;
            emit ExcludedFromFeeSet(account);
        }
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0) && to != address(0), "Invalid address");
        require(_balances[from] >= amount, "Insufficient balance");

        uint256 feeAmount;
        bool sell;
        if (!isExcludedFromFee[from] && !isExcludedFromFee[to]) {
            if (isPair[from] && buyFee > 0) {
                feeAmount = amount * buyFee / FEE_BASE;
            } else if (isPair[to] && sellFee > 0) {
                feeAmount = amount * sellFee / FEE_BASE;
                sell = true;
            }
        }

        uint256 receiveAmount = amount - feeAmount;
        unchecked {
            _balances[from] -= amount;
        }
        _balances[to] += receiveAmount;
        emit Transfer(from, to, receiveAmount);

        if (feeAmount > 0) {
            _balances[feeReceiver] += feeAmount;
            emit Transfer(from, feeReceiver, feeAmount);
            emit FeeCollected(from, to, feeAmount, sell);
        }
    }

    function _approve(address tokenOwner, address spender, uint256 amount) internal {
        require(tokenOwner != address(0) && spender != address(0), "Invalid address");
        _allowances[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "Invalid address");
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(_balances[from] >= amount, "Insufficient balance");
        unchecked {
            _balances[from] -= amount;
        }
        _totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
